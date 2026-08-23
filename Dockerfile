FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render/HF-style platforms run containers as a non-root user; give that
# user ownership so it can write instance/waste.db.
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
ENV HOME=/app \
    FLASK_DEBUG=0 \
    PORT=7860

EXPOSE 7860
CMD ["python", "app.py"]
