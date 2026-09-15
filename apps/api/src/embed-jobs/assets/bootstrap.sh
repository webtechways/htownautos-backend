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
trap 'autodestruir "señal recibida"' INT TERM
trap 'autodestruir "fin del script"' EXIT

mkdir -p /app /workspace
cd /workspace

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
