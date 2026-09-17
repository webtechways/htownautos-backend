"""
Trabajador que corre dentro del pod alquilado.

Pide el manifiesto a la API por TROZOS, baja las fotos de B2, las pasa por
DINOv2, les aplica el PCA CONGELADO y devuelve los vectores de cada trozo antes
de pedir el siguiente. No toca Postgres: solo habla con la API y lee de B2.

── Por que por trozos ──
La primera version se traia el manifiesto entero y acumulaba todos los embeddings
para concatenarlos al final. Con 4.500 imagenes son 27 MB y funciona; con las
1.799.739 de un trabajo real son 11 GB y el pod muere a los cuatro minutos, que
es exactamente lo que paso. Procesando por trozos la memoria queda acotada por el
tamaño del trozo y no por el del trabajo: da igual que queden mil lotes o un
millon.

Se pagina por LOTE y no por imagen porque el vector es el promedio de todas las
fotos del coche: un lote partido entre dos trozos daria un vector distinto del
que daria completo.

── El PCA no se recalcula nunca ──
Viene de la API, congelado. Si se reajustara con los datos de cada noche, los
vectores de hoy dejarian de significar lo mismo que los que entrenaron el modelo,
y este se degradaria sin lanzar un solo error.
"""

import io
import os
import sys
import time

import boto3
import numpy as np
import requests
import torch
from botocore.config import Config
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from transformers import AutoImageProcessor, AutoModel

API = os.environ["API_URL"].rstrip("/")
KEY = os.environ["API_KEY"]
RUN = os.environ["RUN_ID"]
ENCODER = os.environ.get("EMBED_MODEL", "facebook/dinov2-giant")
SIZE = int(os.environ.get("EMBED_SIZE", 518))
BATCH = int(os.environ.get("BATCH", 64))
# Each DataLoader worker is a separate process that forks a copy of the item
# list and opens its own B2 client. With 32 of them and an 18k-item chunk the
# pod died mid-chunk every time, while the same GPU handled a 4.5k chunk fine.
# The GPU only sustains ~14 img/s here, so a handful of workers feeds it easily;
# the extra processes were buying nothing and costing memory.
WORKERS = int(os.environ.get("WORKERS", 6))
MAXSEQ = int(os.environ.get("MAX_SEQ", 9))
# Lots per chunk. 1.000 x 9 photos = ~55 MB of embeddings in flight.
CHUNK = int(os.environ.get("CHUNK_LOTS", 1000))
# The pod is killed from outside when this many minutes are up (`timeout` in the
# bootstrap, and the job's own deadline). The run is sized in LOTS while the
# budget is in MINUTES, and nothing reconciles the two: on 2026-09-16 a run
# asked for 200.000 lots inside a 240 min window at a measured 67,5 lots/min,
# so only ~16.200 could ever fit and the job was guaranteed to be reported as
# failed. Stopping on our own terms turns that into a clean finish with real
# progress, and does it without assuming any particular GPU speed.
MAX_MINUTES = int(os.environ.get("MAX_MINUTES", 180))
H = {"X-API-Key": KEY, "Content-Type": "application/json"}


def rss_gb() -> float:
    """Resident memory of this process tree, in GB.

    Logged at every step because the pod has died three times with the log
    simply stopping — the signature of an OOM kill, which leaves no traceback.
    Without a number next to each step there is no way to tell memory pressure
    from anything else.
    """
    try:
        total = 0
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open(f"/proc/{pid}/statm") as f:
                    total += int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
            except Exception:
                pass
        return total / 1e9
    except Exception:
        return -1.0


def log(msg: str) -> None:
    """Print only. The bootstrap redirects all output to a file and ships it to
    the API every 10 s; sending from here too duplicated every line on screen."""
    print(f"{msg}  [rss {rss_gb():.1f} GB]", flush=True)


class Fotos(Dataset):
    def __init__(self, items, proc):
        self.items, self.proc = items, proc
        self.blank = torch.zeros(3, SIZE, SIZE)
        self._s3 = None

    def s3(self):
        if self._s3 is None:
            self._s3 = boto3.client(
                "s3", endpoint_url=f"https://{os.environ['B2_ENDPOINT']}",
                aws_access_key_id=os.environ["B2_KEY_ID"],
                aws_secret_access_key=os.environ["B2_APP_KEY"],
                config=Config(max_pool_connections=64,
                              retries={"max_attempts": 3, "mode": "adaptive"}))
        return self._s3

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        it = self.items[i]
        try:
            body = self.s3().get_object(
                Bucket=os.environ["B2_BUCKET_PUBLIC"], Key=it["key"])["Body"].read()
            img = Image.open(io.BytesIO(body)).convert("RGB")
            return self.proc(images=img, return_tensors="pt")["pixel_values"][0], 1
        except Exception:
            return self.blank, 0


def procesar(items, proc, model, dev, comps, mean, pcav):
    """Embebe un trozo y devuelve (vectores listos, lotes sin ninguna foto)."""
    dl = DataLoader(Fotos(items, proc), batch_size=BATCH, num_workers=WORKERS,
                    pin_memory=True, prefetch_factor=2)
    log(f"  dataloader up: {len(items):,} images, {WORKERS} workers, batch {BATCH}")
    vecs, oks = [], []
    with torch.inference_mode():
        for n, (px, ok) in enumerate(dl):
            out = model(pixel_values=px.to(dev, torch.float16, non_blocking=True),
                        interpolate_pos_encoding=True)
            vecs.append(out.last_hidden_state[:, 0].float().cpu().numpy())
            oks.append(ok.numpy())
            # Frequent enough that a crash shows how far it got, sparse enough
            # not to flood the log.
            if n and n % 20 == 0:
                log(f"  {n * BATCH:,}/{len(items):,} images")

    E = np.concatenate(vecs)
    ok = np.concatenate(oks) == 1
    por_lote: dict[str, list[np.ndarray]] = {}
    for i, it in enumerate(items):
        if ok[i]:
            por_lote.setdefault(it["lot"], []).append(E[i])

    salida = [
        {"lot": lot,
         "vector": ((np.mean(arr, axis=0) - mean) @ comps.T).astype(np.float32).tolist(),
         "imageCount": len(arr)}
        for lot, arr in por_lote.items()
    ]
    # Lotes cuyas fotos no estan en B2 aunque la base diga que si: se reportan
    # para marcarlos y que no vuelvan a la cola cada noche.
    sin_ninguna = sorted(set(it["lot"] for it in items) - set(por_lote))
    return salida, sin_ninguna, int(ok.sum()), int((~ok).sum())


def main() -> int:
    t0 = time.time()

    pca = np.load("/app/pca_img.npz", allow_pickle=True)
    comps, mean = pca["components"].astype(np.float32), pca["mean"].astype(np.float32)
    pcav = str(pca["pcaVersion"]) if "pcaVersion" in pca else "v1"
    log(f"PCA congelado {comps.shape[1]} -> {comps.shape[0]} dims (version {pcav})")

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    proc = AutoImageProcessor.from_pretrained(
        ENCODER, size={"shortest_edge": SIZE},
        crop_size={"height": SIZE, "width": SIZE})
    model = AutoModel.from_pretrained(ENCODER, dtype=torch.float16).to(dev).eval()
    log(f"modelo {ENCODER} {SIZE}px en {dev} | trozos de {CHUNK:,} lotes")

    # Leave room to finish the chunk in hand and post the results.
    presupuesto_s = MAX_MINUTES * 60
    ultimo_trozo_s = 0.0

    offset = imgs_ok = imgs_mal = lotes_ok = lotes_sin = 0
    while True:
        # Measured, not guessed: the next chunk costs about what the last one
        # cost. Asking for one more that cannot finish wastes GPU minutes and
        # ends the run as a failure instead of a partial success.
        transcurrido = time.time() - t0
        margen = ultimo_trozo_s * 1.2 + 120
        if ultimo_trozo_s and transcurrido + margen > presupuesto_s:
            log(f"parando por presupuesto: {transcurrido/60:.0f} min de "
                f"{MAX_MINUTES} min, el siguiente trozo no cabe "
                f"(~{ultimo_trozo_s/60:.1f} min)")
            break

        log(f"requesting manifest at offset {offset:,}")
        man = requests.get(
            f"{API}/embed-pod/{RUN}/manifest",
            params={"maxSeq": MAXSEQ, "offset": offset, "lots": CHUNK},
            headers=H, timeout=180,
        ).json()
        items = man["items"]
        log(f"manifest: {len(items):,} images")
        if not items:
            break

        t_trozo = time.time()
        salida, sin_ninguna, ok_n, mal_n = procesar(
            items, proc, model, dev, comps, mean, pcav)
        imgs_ok += ok_n
        imgs_mal += mal_n

        for i in range(0, len(salida), 500):
            requests.post(f"{API}/embed-pod/{RUN}/vectors", headers=H, timeout=180,
                          json={"items": salida[i:i + 500],
                                "encoder": f"{ENCODER}@{SIZE}", "pcaVersion": pcav})
        if sin_ninguna:
            requests.post(f"{API}/embed-pod/{RUN}/complete", headers=H, timeout=60,
                          json={"parcial": True, "lotsWithoutImages": sin_ninguna})

        lotes_ok += len(salida)
        lotes_sin += len(sin_ninguna)
        ultimo_trozo_s = time.time() - t_trozo
        offset += CHUNK
        ritmo = (imgs_ok + imgs_mal) / max(time.time() - t0, 1)
        log(f"trozo hasta {offset:,}: +{len(salida):,} lotes "
            f"({lotes_ok:,} en total) · {ritmo:.0f} img/s")

    requests.post(f"{API}/embed-pod/{RUN}/complete", headers=H, timeout=60,
                  json={"imagesDone": imgs_ok, "imagesFailed": imgs_mal})
    log(f"listo: {lotes_ok:,} lotes, {imgs_ok:,} imagenes, "
        f"{lotes_sin:,} sin fotos, en {(time.time()-t0)/60:.1f} min")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        try:
            requests.post(f"{API}/embed-pod/{RUN}/complete", headers=H, timeout=30,
                          json={"error": str(e)[:500]})
        except Exception:
            pass
        raise
