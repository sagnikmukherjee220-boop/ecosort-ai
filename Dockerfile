FROM python:3.12-slim

# opencv (even headless) needs these system libs to import cv2
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only torch first — the default ultralytics pulls in the much
# larger CUDA build, which is wasted size/build-time on a CPU-only host.
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces run containers as a non-root user; give that user
# ownership so it can write instance/waste.db and the ultralytics cache.
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
ENV HOME=/app \
    FLASK_DEBUG=0 \
    PORT=7860

EXPOSE 7860
CMD ["python", "app.py"]
