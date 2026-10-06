# Serviço de OCR (PaddleOCR) usado pelo plugin @transynex/ocr-paddle.
#   docker build -t transynex-paddle-ocr services/paddle-ocr
# Os modelos são baixados na primeira requisição de cada idioma e ficam em
# /root/.paddlex (monte um volume para não baixar de novo a cada subida).
FROM python:3.11-slim

# libgl/libglib: exigidos pelo OpenCV que o PaddleOCR usa.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

# Modelos vêm do CDN da Baidu (BOS), sem o teste de conectividade do PaddleX:
# esse teste falha à toa (HuggingFace/ModelScope inacessíveis numa rede sem
# IPv6, como a padrão do compose), o resultado vazio fica em cache no processo
# e todo download seguinte dá "No available model hosting platforms detected".
ENV PADDLE_PDX_MODEL_SOURCE=BOS \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

EXPOSE 8866
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8866"]
