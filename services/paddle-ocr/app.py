"""Serviço HTTP mínimo em volta do PaddleOCR (consumido pelo plugin @transynex/ocr-paddle).

POST /ocr   multipart: image=<arquivo>, lang=<código PaddleOCR, ex: japan, en, ch>
            → {"lines": [{"polygon": [[x,y],...], "text": str, "score": float}], "ms": int}
GET  /health → {"ok": true, "loaded": [langs]}

PADDLE_OCR_PRELOAD="en,japan" baixa/carrega esses idiomas na subida, em segundo
plano, para a primeira página não esperar o download do modelo.
"""
import logging
import os
import threading
import time

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="paddle-ocr")

# Uma instância por idioma (cada uma carrega seu modelo de reconhecimento).
_engines: dict[str, PaddleOCR] = {}
# ponytail: lock global — o PaddleOCR não é thread-safe; para paralelismo real, rode mais réplicas do serviço.
_lock = threading.Lock()


def _engine(lang: str) -> PaddleOCR:
    if lang not in _engines:
        _engines[lang] = PaddleOCR(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
    return _engines[lang]


def _preload(langs: list[str]) -> None:
    for lang in langs:
        try:
            with _lock:
                _engine(lang)
            logging.warning("paddle-ocr: modelo '%s' pronto", lang)
        except Exception:  # idioma inválido/sem rede: a 1ª requisição tenta de novo
            logging.exception("paddle-ocr: falha ao pré-carregar '%s'", lang)


# Thread separada: o serviço já responde (/health) enquanto os modelos baixam.
_langs = [l.strip() for l in os.environ.get("PADDLE_OCR_PRELOAD", "").split(",") if l.strip()]
threading.Thread(target=_preload, args=(_langs,), daemon=True).start()


@app.get("/health")
def health():
    return {"ok": True, "loaded": sorted(_engines)}


@app.post("/ocr")
def ocr(image: UploadFile = File(...), lang: str = Form("en")):
    data = np.frombuffer(image.file.read(), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "imagem inválida")

    start = time.time()
    with _lock:
        try:
            results = _engine(lang).predict(img)
        except ValueError as e:  # idioma não suportado
            raise HTTPException(400, str(e)) from e

    lines = []
    for res in results:
        for poly, text, score in zip(res["rec_polys"], res["rec_texts"], res["rec_scores"]):
            if text.strip():
                lines.append(
                    {"polygon": np.asarray(poly).tolist(), "text": text, "score": float(score)}
                )
    return {"lines": lines, "ms": int((time.time() - start) * 1000)}
