#!/usr/bin/env bash
#
# Arranque del pod alquilado. Lo sirve la API y lo ejecuta RunPod como comando de
# inicio del contenedor.
#
# El pod usa la imagen estandar de PyTorch de RunPod y se trae el codigo de la API
# en vez de tener una imagen propia. Evita depender de un registro de contenedores
# y, sobre todo, garantiza que el worker y el PCA que corren son EXACTAMENTE los
# de la version desplegada del backend: no hay forma de que una imagen vieja siga
# por ahi generando vectores incompatibles con el modelo en produccion.
#
# Cuesta ~40 s de pip por noche. A precio de A40 son centimos.
set -uo pipefail

: "${RUNPOD_POD_ID:=}"
: "${RUNPOD_API_KEY:=}"
: "${MAX_MINUTES:=180}"

# ── Via 5 de apagado ──
# Las otras cuatro viven dentro del backend. Si el host de Oracle se cae a mitad
# de la noche, el job y el vigilante desaparecen con el y solo queda esto.
autodestruir() {
  echo "[bootstrap] apagando pod ($1)"
  if [ -n "$RUNPOD_POD_ID" ] && [ -n "$RUNPOD_API_KEY" ]; then
    for intento in 1 2 3; do
      code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
        -H "Authorization: Bearer $RUNPOD_API_KEY" \
        "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" || echo 000)
      # 204 = borrado, 404 = ya no existe. Las dos valen.
      if [ "$code" = "204" ] || [ "$code" = "404" ]; then
        echo "[bootstrap] pod borrado (HTTP $code)"
        return 0
      fi
      echo "[bootstrap] intento $intento fallo (HTTP $code)"
      sleep 5
    done
    echo "[bootstrap] NO SE PUDO BORRAR EL POD - el vigilante deberia recogerlo"
  else
    echo "[bootstrap] sin RUNPOD_POD_ID o RUNPOD_API_KEY; no puedo autodestruirme"
  fi
}
cerrar() {
  # Un ultimo envio antes de morir: lo mas util del log suele ser lo ultimo.
  kill "${LOGPID:-0}" 2>/dev/null || true
  autodestruir "$1"
}
trap 'cerrar "señal recibida"' INT TERM
trap 'cerrar "fin del script"' EXIT

mkdir -p /app /workspace
cd /workspace

# ── Todo lo que escriba este script o el worker se manda a la API ──
# Sin esto, un fallo dentro del pod (pip que no instala, curl que no resuelve,
# una traza de Python) se queda en una maquina que se autodestruye minutos
# despues y no queda rastro de por que fallo.
LOGF=/workspace/pod.log
: > "$LOGF"
exec > >(tee -a "$LOGF") 2>&1

# El emisor va en su propio fichero: encadenar un heredoc con una here-string
# en la misma orden hace que bash se quede con la ultima, y Python acabaria
# recibiendo el log como si fuera su codigo fuente.
cat > /workspace/enviar_log.py <<'PYEOF'
import json, sys, urllib.request
api, key, run = sys.argv[1], sys.argv[2], sys.argv[3]
texto = sys.stdin.read().strip()
if texto:
    req = urllib.request.Request(
        f"{api}/embed-pod/{run}/log", method="POST",
        data=json.dumps({"line": texto}).encode(),
        headers={"X-API-Key": key, "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=15).read()
PYEOF

enviar_logs() {
  local pos=0 nuevo
  while true; do
    sleep 10
    nuevo=$(tail -c +$((pos + 1)) "$LOGF" 2>/dev/null) || continue
    if [ -n "$nuevo" ]; then
      pos=$(wc -c < "$LOGF")
      printf '%s' "$nuevo" | python3 /workspace/enviar_log.py \
        "$API_URL" "$API_KEY" "$RUN_ID" 2>/dev/null || true
    fi
  done
}
enviar_logs &
LOGPID=$!

echo "[bootstrap] instalando dependencias"
pip install --no-cache-dir -q transformers pillow requests boto3 numpy || true

echo "[bootstrap] descargando worker y PCA congelado"
curl -fsS -H "X-API-Key: $API_KEY" "$API_URL/embed-pod/worker.py" -o /workspace/worker.py
curl -fsS -H "X-API-Key: $API_KEY" "$API_URL/embed-pod/pca_img.npz" -o /app/pca_img.npz

# `timeout` es el segundo cinturon: si el worker se cuelga, muere igual y el trap
# de EXIT borra el pod de todas formas.
echo "[bootstrap] arrancando worker (limite ${MAX_MINUTES}m)"
timeout --signal=TERM "${MAX_MINUTES}m" python3 -u /workspace/worker.py
echo "[bootstrap] worker salio con codigo $?"
