"""
app.py — Flask backend for the AI Waste Segregation website.

Run locally in VS Code (no Colab, no external cloud):
    python app.py
Then, to demo it from any device / show your examiner a public link,
expose it yourself with localtunnel (you stay in full control):
    npm install -g localtunnel
    lt --port 5000

See README.md for full setup instructions.
"""
import base64
import io
import os
import time

from flask import Flask, render_template, request, jsonify
from PIL import Image
import numpy as np

import db
import waste_map
from chatbot_engine import get_response

app = Flask(__name__)

# ----------------------------------------------------------------------
# Load the pretrained YOLOv8 model once at startup (lazy import so the
# website's other pages still work even before the (~6MB) weights file
# has finished downloading the very first time you run the app).
# ----------------------------------------------------------------------
_model = None


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO("yolov8n.pt")  # auto-downloads once, then cached locally
    return _model


CONF_THRESHOLD_DEFAULT = 0.35


def decode_image(data_url_or_file):
    """Accept either a base64 data-URL (from webcam canvas) or an uploaded file."""
    if hasattr(data_url_or_file, "read"):
        img = Image.open(data_url_or_file.stream).convert("RGB")
    else:
        header, encoded = data_url_or_file.split(",", 1)
        img_bytes = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return np.array(img)


def run_detection(img_array, conf_threshold=CONF_THRESHOLD_DEFAULT):
    model = get_model()
    results = model.predict(img_array, conf=conf_threshold, verbose=False)[0]
    detections = []
    names = results.names
    for box in results.boxes:
        cls_id = int(box.cls[0])
        label = names[cls_id]
        confidence = float(box.conf[0])
        xyxy = box.xyxy[0].tolist()
        category, meta = waste_map.classify(label)
        detections.append({
            "label": label,
            "confidence": round(confidence, 3),
            "box": [round(v, 1) for v in xyxy],
            "category": category,
            "category_label": meta["label"],
            "color": meta["color"],
            "bin": meta["bin"],
            "tip": meta["tip"],
            "points": meta["points"],
        })
    return detections


# ------------------------------- PAGES ---------------------------------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/detect")
def detect_page():
    return render_template("detect.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


@app.route("/chatbot")
def chatbot_page():
    return render_template("chatbot.html")


@app.route("/guidelines")
def guidelines_page():
    import json, os
    path = os.path.join(os.path.dirname(__file__), "data", "guidelines.json")
    with open(path, encoding="utf-8") as f:
        guidelines = json.load(f)
    return render_template("guidelines.html", guidelines=guidelines)


@app.route("/about")
def about_page():
    return render_template("about.html")


@app.route("/certificate")
def certificate_page():
    stats = db.get_stats()
    return render_template("certificate.html", stats=stats)


# ------------------------------- API ------------------------------------

@app.route("/api/detect", methods=["POST"])
def api_detect():
    t0 = time.time()
    payload = request.get_json(silent=True)
    source = "webcam"
    if payload and "image" in payload:
        img_array = decode_image(payload["image"])
        source = payload.get("source", "webcam")
    elif "image" in request.files:
        img_array = decode_image(request.files["image"])
        source = "upload"
    else:
        return jsonify({"error": "no image provided"}), 400

    conf = float(request.args.get("conf", CONF_THRESHOLD_DEFAULT))
    detections = run_detection(img_array, conf_threshold=conf)

    # log every real (non-ignored) waste detection for the dashboard/gamification
    for d in detections:
        if d["category"] != "ignore":
            db.log_detection(d["label"], d["category"], d["confidence"], d["points"], source)

    return jsonify({
        "detections": detections,
        "count": len(detections),
        "inference_ms": round((time.time() - t0) * 1000, 1),
    })


@app.route("/api/stats")
def api_stats():
    return jsonify(db.get_stats())


@app.route("/api/clear_history", methods=["POST"])
def api_clear_history():
    db.clear_history()
    return jsonify({"ok": True})


@app.route("/api/chatbot", methods=["POST"])
def api_chatbot():
    payload = request.get_json(silent=True) or {}
    message = payload.get("message", "")
    return jsonify(get_response(message))


@app.route("/api/categories")
def api_categories():
    return jsonify(waste_map.all_categories())


if __name__ == "__main__":
    db.init_db()
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    print("\n  AI Waste Segregation website starting...")
    print(f"  Local:   http://127.0.0.1:{port}")
    print("  To share it yourself: run  lt --port 5000  in another terminal\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
