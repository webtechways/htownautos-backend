"""
Trabajador que corre dentro del pod alquilado.

Pide el manifiesto a la API, baja las fotos de B2, las pasa por DINOv2, les aplica
el PCA CONGELADO que viene en la imagen, y devuelve los vectores. No toca Postgres:
solo sabe hablar con tres rutas de la API y leer de B2.

El PCA va dentro de la imagen y no se recalcula nunca. Si se reajustara con los
datos de cada noche, los vectores de hoy dejarian de significar lo mismo que los
que entrenaron el modelo, y este se degradaria sin lanzar un solo error.
"""

import io
import json
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
WORKERS = int(os.environ.get("WORKERS", 32))
MAXSEQ = int(os.environ.get("MAX_SEQ", 9))
H = {"X-API-Key": KEY, "Content-Type": "application/json"}


def log(msg: str) -> None:
    print(msg, flush=True)
    try:
        requests.post(f"{API}/embed-pod/{RUN}/log", headers=H,
                      json={"line": msg}, timeout=10)
    except Exception:
        pass


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


def main() -> int:
    t0 = time.time()
    man = requests.get(f"{API}/embed-pod/{RUN}/manifest?maxSeq={MAXSEQ}",
                       headers=H, timeout=120).json()
    items = man["items"]
    lotes = sorted({it["lot"] for it in items})
    log(f"manifiesto: {len(items):,} imagenes de {len(lotes):,} lotes")
    if not items:
        requests.post(f"{API}/embed-pod/{RUN}/complete", headers=H, json={}, timeout=30)
        return 0

    pca = np.load("/app/pca_img.npz", allow_pickle=True)
    comps, mean = pca["components"].astype(np.float32), pca["mean"].astype(np.float32)
    pcav = str(pca["pcaVersion"]) if "pcaVersion" in pca else "v1"
    log(f"PCA congelado {comps.shape[1]} -> {comps.shape[0]} dims (version {pcav})")

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    proc = AutoImageProcessor.from_pretrained(
        ENCODER, size={"shortest_edge": SIZE},
        crop_size={"height": SIZE, "width": SIZE})
    model = AutoModel.from_pretrained(ENCODER, dtype=torch.float16).to(dev).eval()
    log(f"modelo {ENCODER} {SIZE}px en {dev}")

    dl = DataLoader(Fotos(items, proc), batch_size=BATCH, num_workers=WORKERS,
                    pin_memory=True, prefetch_factor=4)

    vecs, oks = [], []
    with torch.inference_mode():
        for n, (px, ok) in enumerate(dl):
            out = model(pixel_values=px.to(dev, torch.float16, non_blocking=True),
                        interpolate_pos_encoding=True)
            vecs.append(out.last_hidden_state[:, 0].float().cpu().numpy())
            oks.append(ok.numpy())
            if n % 50 == 0 and n:
                hechas = n * BATCH
                log(f"{hechas:,}/{len(items):,} ({hechas/(time.time()-t0):.0f} img/s)")

    E = np.concatenate(vecs)
    ok = np.concatenate(oks) == 1
    fallos = int((~ok).sum())
    log(f"codificadas {len(E):,} imagenes, {fallos} fallidas")

    # Promedio por lote (el agrupado que gano en la comparacion) y PCA congelado.
    por_lote: dict[str, list[np.ndarray]] = {}
    for i, it in enumerate(items):
        if ok[i]:
            por_lote.setdefault(it["lot"], []).append(E[i])

    salida = []
    for lot, arr in por_lote.items():
        m = np.mean(arr, axis=0)
        salida.append({"lot": lot,
                       "vector": ((m - mean) @ comps.T).astype(np.float32).tolist(),
                       "imageCount": len(arr)})

    for i in range(0, len(salida), 500):
        requests.post(f"{API}/embed-pod/{RUN}/vectors", headers=H, timeout=180,
                      json={"items": salida[i:i + 500], "encoder": f"{ENCODER}@{SIZE}",
                            "pcaVersion": pcav})
        log(f"enviados {min(i+500, len(salida)):,}/{len(salida):,} vectores")

    requests.post(f"{API}/embed-pod/{RUN}/complete", headers=H, timeout=30,
                  json={"imagesDone": int(ok.sum()), "imagesFailed": fallos})
    log(f"listo en {(time.time()-t0)/60:.1f} min")
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
