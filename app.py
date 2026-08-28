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
import json
import os
import time

from authlib.integrations.flask_client import OAuth
from flask import Flask, render_template, request, jsonify, url_for, session, redirect
from huggingface_hub import InferenceClient
from PIL import Image
from werkzeug.middleware.proxy_fix import ProxyFix

import db
import waste_map
from chatbot_engine import get_response

app = Flask(__name__)
# Render (like most hosts) terminates HTTPS at its own proxy and forwards
# plain HTTP to the app, so Flask sees every request as http:// unless told
# otherwise. Without this, url_for(..., _external=True) generates an
# http:// callback URL that doesn't match the https:// one registered in
# Google Cloud Console, and Google rejects the sign-in with
# "redirect_uri_mismatch". ProxyFix reads the proxy's X-Forwarded-Proto
# header to report the real scheme.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
# Session cookies are signed with this key. Set FLASK_SECRET_KEY as an env
# var (like HF_TOKEN) in production so logins survive a restart instead of
# invalidating every session; falls back to a random one for local dev.
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or os.urandom(24)

# ----------------------------------------------------------------------
# Google sign-in (optional — visitors can also "Continue as Guest"). Needs
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars from a Google Cloud
# Console OAuth client. Only used for identity (name/photo in the navbar);
# eco-points/dashboard history stays shared/global either way.
# ----------------------------------------------------------------------
oauth = OAuth(app)
oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@app.context_processor
def inject_user():
    return {"current_user": session.get("user")}


@app.template_global()
def versioned_static(filename):
    """url_for('static', ...) plus a ?v=<mtime> cache-buster, so browsers
    fetch the new copy of a JS/CSS file after a deploy instead of serving a
    stale cached one (bit us once already after an update)."""
    path = os.path.join(app.static_folder, filename)
    try:
        version = int(os.path.getmtime(path))
    except OSError:
        version = 0
    return url_for("static", filename=filename) + f"?v={version}"

# ----------------------------------------------------------------------
# Object identification runs on a vision-language model via Hugging Face's
# Inference Providers, instead of a fixed-80-class local detector. This
# trades away offline operation for genuinely open-vocabulary recognition
# (anything the model can name, not just COCO's 80 classes) — see README
# for the reasoning. Needs an HF_TOKEN env var (a Hugging Face access
# token with "Make calls to Inference Providers" permission).
# ----------------------------------------------------------------------
_hf_client = None
VLM_MODEL = "meta-llama/Llama-4-Scout-17B-16E-Instruct"
VLM_PROVIDER = "deepinfra"


def get_hf_client():
    global _hf_client
    if _hf_client is None:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN environment variable is not set")
        _hf_client = InferenceClient(api_key=token, provider=VLM_PROVIDER)
    return _hf_client


CONF_THRESHOLD_DEFAULT = 0.35

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi",
}


MAX_IMAGE_DIM = 1280  # longest side, in pixels


def decode_image(data_url_or_file):
    """Accept either a base64 data-URL (from webcam canvas) or an uploaded file.
    Returns (PIL.Image, base64 data-URI string) — the model needs the data URI.

    Always downscales to MAX_IMAGE_DIM on the longest side and re-encodes at
    quality 92 (server-side safety net — the client downscales too, but a
    direct API caller or a browser that skips the client-side resize would
    otherwise still ship a multi-megabyte phone photo). This cuts upload and
    inference latency on large/complex images without materially hurting
    accuracy, since hosted vision models cap their effective input
    resolution similarly anyway."""
    if hasattr(data_url_or_file, "read"):
        img = Image.open(data_url_or_file.stream).convert("RGB")
    else:
        header, encoded = data_url_or_file.split(",", 1)
        img_bytes = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

    img.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    data_uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return img, data_uri


def build_prompt(conf_threshold: float, lang: str) -> str:
    if conf_threshold >= 0.45:
        inclusiveness = "Only list objects you can identify with high confidence."
    elif conf_threshold <= 0.25:
        inclusiveness = "List every object you can find, even ones you're only somewhat sure about."
    else:
        inclusiveness = "List objects you can identify with reasonable confidence."

    lang_name = LANG_NAMES.get(lang, "English")
    category_list = ", ".join(list(waste_map.CATEGORY_META) + ["ignore"])

    return (
        "You are a waste-segregation assistant. Identify every distinct physical "
        f"object in this image. {inclusiveness} Look carefully at every part of "
        "the image, including small or partially hidden objects (e.g. a remote "
        "control, a charger, a cable) — don't stop at the first few obvious items.\n"
        "Be careful with ambiguous packaging: only name a specific sensitive "
        "product (tobacco, alcohol, weapons, drugs, etc.) if you're genuinely "
        "confident from clear visual evidence like readable text or branding. "
        "If you're not sure, describe it generically instead (e.g. 'small box' "
        "or 'packet') rather than guessing a specific, potentially wrong and "
        "sensitive label.\n"
        f"For each object, write its name in {lang_name}, and classify it into "
        f"exactly one of these categories: {category_list}. Use 'ignore' for "
        "anything that isn't a discardable waste item (people, animals, "
        "vehicles, furniture, walls, etc).\n"
        "Also give a confidence score from 0 to 1 for your own identification.\n"
        'Respond with ONLY a JSON array, no other text, no markdown fences, '
        'where each item is exactly: '
        '{"label": "object name", "category": "category key", "confidence": 0.0}'
    )


def run_detection(image: Image.Image, image_data_uri: str, conf_threshold=CONF_THRESHOLD_DEFAULT, lang="en"):
    client = get_hf_client()
    prompt = build_prompt(conf_threshold, lang)

    response = client.chat.completions.create(
        model=VLM_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_data_uri}},
            ],
        }],
        max_tokens=800,
    )
    raw = response.choices[0].message.content.strip()
    # Models sometimes wrap JSON in ```json fences despite instructions not to.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []

    detections = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or "label" not in item:
            continue
        category, meta = waste_map.category_meta(item.get("category", "ignore"))
        try:
            confidence = float(item.get("confidence", 0.5))
        except (TypeError, ValueError):
            confidence = 0.5
        detections.append({
            "label": str(item["label"])[:60],
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "box": None,  # the model doesn't give reliable pixel-accurate boxes
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


# ------------------------------- AUTH ------------------------------------

@app.route("/auth/login/google")
def auth_login_google():
    redirect_uri = url_for("auth_callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def auth_callback():
    token = oauth.google.authorize_access_token()
    userinfo = token.get("userinfo") or {}
    google_sub = userinfo.get("sub")
    email = userinfo.get("email", "")
    name = userinfo.get("name") or email or "there"
    picture = userinfo.get("picture")
    if google_sub:
        db.upsert_user(google_sub, email, name, picture)
        session["user"] = {"name": name, "email": email, "picture": picture}
    return redirect(url_for("home"))


@app.route("/auth/logout")
def auth_logout():
    session.pop("user", None)
    return redirect(url_for("home"))


# ------------------------------- API ------------------------------------

@app.route("/api/detect", methods=["POST"])
def api_detect():
    t0 = time.time()
    payload = request.get_json(silent=True)
    source = "webcam"
    lang = "en"
    if payload and "image" in payload:
        image, image_data_uri = decode_image(payload["image"])
        source = payload.get("source", "webcam")
        lang = payload.get("lang", "en")
    elif "image" in request.files:
        image, image_data_uri = decode_image(request.files["image"])
        source = "upload"
        lang = request.form.get("lang", "en")
    else:
        return jsonify({"error": "no image provided"}), 400

    conf = float(request.args.get("conf", CONF_THRESHOLD_DEFAULT))
    try:
        detections = run_detection(image, image_data_uri, conf_threshold=conf, lang=lang)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

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
    history = payload.get("history") or []
    return jsonify(get_response(history))


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
