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
import itertools
import json
import os
import time

import requests
from authlib.integrations.flask_client import OAuth
from flask import (Flask, render_template, request, jsonify, url_for, session, redirect, g,
                   Response, stream_with_context)
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
_hf_clients = {}
VLM_MODEL = "meta-llama/Llama-4-Scout-17B-16E-Instruct"
# Tried in order; if one provider errors or is down the next is used, so a
# single provider outage doesn't take detection offline.
VLM_PROVIDERS = ["deepinfra", "novita", "nscale"]


def get_hf_client(provider):
    if provider not in _hf_clients:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN environment variable is not set")
        _hf_clients[provider] = InferenceClient(api_key=token, provider=provider, timeout=90)
    return _hf_clients[provider]


# Backup vision backends, tried in order after Hugging Face. Each takes a key
# from its env var; the model can be overridden with <NAME>_MODEL
# (GEMINI_MODEL / GROQ_MODEL), e.g. if the default is retired.
OPENAI_COMPAT_BACKENDS = [
    ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
     "GEMINI_API_KEY", "gemini-3.8-flash", "low"),
    ("groq", "https://api.groq.com/openai/v1/chat/completions",
     "GROQ_API_KEY", "qwen/qwen3.8-27b", "none"),
]
# These are "thinking" models; for a simple list-the-objects task, thinking
# only adds latency, so ask for as little as possible. If a model rejects the
# setting (HTTP 400) the call is retried without it.


def call_openai_compat(url, key, model, messages, reasoning=None):
    body = {"model": model, "messages": messages, "max_tokens": 800}
    for attempt in ((True, False) if reasoning else (False,)):
        payload = dict(body, reasoning_effort=reasoning) if attempt else body
        resp = requests.post(
            url, headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=40)
        if resp.status_code == 400 and attempt:
            continue
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code} {resp.text[:200]}")
        return resp.json()["choices"][0]["message"]["content"]


# When Hugging Face reports no credits, skip it for a while instead of making
# every photo wait on three failing provider calls first.
_hf_skip_until = 0.0


def friendly_ai_error(errors):
    """One plain-English line for the user, from the per-provider errors."""
    text = " ".join(errors).lower()
    if "hf_token" in text:
        return "The AI service isn't configured on the server (missing access token)."
    if "402" in text or "credit" in text or "payment" in text:
        return "The AI service has used up its free credits. Please try again later."
    if "429" in text or "rate" in text:
        return "The AI service is busy right now. Please try again in a minute."
    if "401" in text or "403" in text or "token" in text:
        return "The AI service rejected the server's access token."
    return "The AI service is not responding right now. Please try again in a moment."


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


NARRATION_MARK = "###JSON"


def build_prompt(conf_threshold: float, lang: str, narrate: bool = False) -> str:
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
        f"thing visible in this image — both discardable waste items AND the "
        f"surrounding non-waste things (people, animals, vehicles, furniture, "
        f"walls, curtains, floors, doors, windows, appliances, etc). {inclusiveness} "
        "Look carefully at every part of the image, foreground and background "
        "alike, including small or partially hidden objects (e.g. a remote "
        "control, a charger, a cable) — don't stop at the first few obvious "
        "items, and don't skip background/room elements just because they "
        "aren't waste; list them too with category 'ignore'.\n"
        "Be careful with ambiguous packaging: only name a specific sensitive "
        "product (tobacco, alcohol, weapons, drugs, etc.) if you're genuinely "
        "confident from clear visual evidence like readable text or branding. "
        "If you're not sure, describe it generically instead (e.g. 'small box' "
        "or 'packet') rather than guessing a specific, potentially wrong and "
        "sensitive label.\n"
        f"For each thing, write its name in {lang_name}, and classify it into "
        f"exactly one of these categories: {category_list}. Use 'ignore' for "
        "anything that isn't a discardable waste item (people, animals, "
        "vehicles, furniture, walls, curtains, floors, and other fixed "
        "room/background elements).\n"
        "Also give a confidence score from 0 to 1 for your own identification.\n"
        + (
            f"First, think out loud in {lang_name}: write 4 to 8 short lines, each starting "
            "with '• ', narrating what you notice — the overall scene, where things are, "
            "materials, small or partly hidden items, and why each item belongs in the "
            f"category you choose. Then write a line containing exactly {NARRATION_MARK} and, "
            "after it, ONLY a JSON array (no markdown fences) where each item is exactly: "
            if narrate else
            'Respond with ONLY a JSON array, no other text, no markdown fences, '
            'where each item is exactly: '
        )
        + '{"label": "object name", "category": "category key", "confidence": 0.0}'
    )


def run_detection(image: Image.Image, image_data_uri: str, conf_threshold=CONF_THRESHOLD_DEFAULT, lang="en"):
    prompt = build_prompt(conf_threshold, lang)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_data_uri}},
        ],
    }]

    raw, errors = None, []
    global _hf_skip_until
    if os.environ.get("HF_TOKEN") and time.time() >= _hf_skip_until:
        for provider in VLM_PROVIDERS:
            try:
                response = get_hf_client(provider).chat.completions.create(
                    model=VLM_MODEL, messages=messages, max_tokens=800)
                raw = response.choices[0].message.content
                g.engine = "Llama-4 Scout (Hugging Face)"
                break
            except Exception as e:  # noqa: BLE001 - any provider failure -> try the next one
                app.logger.warning("detection via %s failed: %s: %s", provider, type(e).__name__, e)
                errors.append(f"{provider}: {type(e).__name__} {e}")
                if "402" in str(e) or "credit" in str(e).lower():
                    _hf_skip_until = time.time() + 600
                    break
    # Backups: any OpenAI-compatible vision API with a free tier. Only tried
    # when their key is set, and only after Hugging Face failed or is unset.
    if raw is None:
        # In order of quality: Gemini first, Groq only if Gemini fails.
        for name, url, key_env, model, reasoning in OPENAI_COMPAT_BACKENDS:
            key = os.environ.get(key_env)
            if not key:
                continue
            try:
                raw = call_openai_compat(url, key, os.environ.get(key_env.replace("_API_KEY", "_MODEL"), model),
                                         messages, reasoning)
                g.engine = {"gemini": "Google Gemini", "groq": "Groq"}.get(name, name)
                break
            except Exception as e:  # noqa: BLE001
                app.logger.warning("detection via %s failed: %s: %s", name, type(e).__name__, e)
                errors.append(f"{name}: {type(e).__name__} {e}")
    if raw is None:
        if not errors:
            errors.append("hf_token missing")
        raise RuntimeError(friendly_ai_error(errors))
    return detections_from_raw(raw)


def detections_from_raw(raw):
    """Turn the model's JSON text into the list of detection dicts."""
    raw = (raw or "").strip()
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


def _stream_hf(provider, messages):
    stream = get_hf_client(provider).chat.completions.create(
        model=VLM_MODEL, messages=messages, max_tokens=1200, stream=True)
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def _stream_openai_compat(url, key, model, messages, reasoning=None):
    body = {"model": model, "messages": messages, "max_tokens": 1200, "stream": True}
    for attempt in ((True, False) if reasoning else (False,)):
        payload = dict(body, reasoning_effort=reasoning) if attempt else body
        resp = requests.post(url, headers={"Authorization": f"Bearer {key}"},
                             json=payload, timeout=40, stream=True)
        if resp.status_code == 400 and attempt:
            resp.close()
            continue
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code} {resp.text[:200]}")
        break
    resp.encoding = "utf-8"
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            delta = json.loads(data)["choices"][0]["delta"].get("content")
        except (KeyError, IndexError, ValueError):
            continue
        if delta:
            yield delta


def open_stream(messages):
    """Try each backend in turn until one starts streaming text. Returns
    (engine name, iterator of text pieces); the first piece is already pulled
    so a backend that fails immediately falls through to the next one."""
    global _hf_skip_until
    errors = []
    attempts = []
    if os.environ.get("HF_TOKEN") and time.time() >= _hf_skip_until:
        attempts += [("Llama-4 Scout (Hugging Face)", p, lambda p=p: _stream_hf(p, messages))
                     for p in VLM_PROVIDERS]
    for name, url, key_env, model, reasoning in OPENAI_COMPAT_BACKENDS:
        key = os.environ.get(key_env)
        if key:
            m = os.environ.get(key_env.replace("_API_KEY", "_MODEL"), model)
            attempts.append(({"gemini": "Google Gemini", "groq": "Groq"}.get(name, name), name,
                             lambda u=url, k=key, m=m, r=reasoning: _stream_openai_compat(u, k, m, messages, r)))
    hf_dead = False
    for engine, tag, make in attempts:
        if hf_dead and tag in VLM_PROVIDERS:
            continue
        try:
            it = make()
            first = next(it)
            return engine, itertools.chain([first], it)
        except Exception as e:  # noqa: BLE001
            app.logger.warning("streamed detection via %s failed: %s: %s", tag, type(e).__name__, e)
            errors.append(f"{tag}: {type(e).__name__} {e}")
            if tag in VLM_PROVIDERS and ("402" in str(e) or "credit" in str(e).lower()):
                _hf_skip_until = time.time() + 600
                hf_dead = True
    if not errors:
        errors.append("hf_token missing")
    raise RuntimeError(friendly_ai_error(errors))


# ------------------------------- PAGES ---------------------------------

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/detect")
def detect_page():
    import json, os
    path = os.path.join(os.path.dirname(__file__), "data", "guidelines.json")
    with open(path, encoding="utf-8") as f:
        categories = json.load(f)
    return render_template("detect.html", categories=categories)


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
    # points come from waste_map (the single source of truth the app itself
    # actually awards from), not duplicated into guidelines.json
    for g in guidelines:
        g["points"] = waste_map.CATEGORY_META.get(g["key"], {}).get("points", 0)
    return render_template("guidelines.html", guidelines=guidelines)


@app.route("/about")
def about_page():
    return render_template("about.html")


@app.route("/certificate")
def certificate_page():
    stats = db.get_stats(current_user_id())
    return render_template("certificate.html", stats=stats)


def current_user_id():
    """The signed-in user's DB id, or None for a guest. Detections/points
    are only ever saved against a real id — guests never get anything
    written, so nothing about their visit is saved anywhere."""
    user = session.get("user")
    return user.get("id") if user else None


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
        user_id = db.upsert_user(google_sub, email, name, picture)
        session["user"] = {"id": user_id, "name": name, "email": email, "picture": picture}
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
        return jsonify({"error": str(e)}), 503
    except Exception:  # noqa: BLE001 - never leak a raw 500 page to the browser
        app.logger.exception("unexpected error during detection")
        return jsonify({"error": "Something went wrong while analysing the image. Please try again."}), 500

    # Log every real (non-ignored) waste detection for the dashboard/
    # gamification — but only for signed-in users. Guests get their results
    # shown on screen same as anyone else, just never written anywhere, so
    # a guest visit leaves no trace and starts fresh again next time.
    log_user_detections(detections, source, current_user_id())

    return jsonify({
        "detections": detections,
        "count": len(detections),
        "inference_ms": round((time.time() - t0) * 1000, 1),
        "engine": getattr(g, "engine", None),
    })


def log_user_detections(detections, source, user_id):
    if user_id:
        for d in detections:
            if d["category"] != "ignore":
                db.log_detection(d["label"], d["category"], d["confidence"], d["points"], source, user_id)


@app.route("/api/detect_stream", methods=["POST"])
def api_detect_stream():
    """Same job as /api/detect, but streams newline-delimited JSON events:
    {"type":"engine"}, a series of {"type":"note"} with the model's running
    commentary (in the user's language), then one {"type":"result"} (or
    {"type":"error"}). The commentary comes from the same single model call."""
    t0 = time.time()
    payload = request.get_json(silent=True) or {}
    if "image" not in payload:
        return jsonify({"error": "no image provided"}), 400
    image, image_data_uri = decode_image(payload["image"])
    source = payload.get("source", "webcam")
    lang = payload.get("lang", "en")
    conf = float(request.args.get("conf", CONF_THRESHOLD_DEFAULT))
    user_id = current_user_id()
    messages = [{"role": "user", "content": [
        {"type": "text", "text": build_prompt(conf, lang, narrate=True)},
        {"type": "image_url", "image_url": {"url": image_data_uri}}]}]

    def event(**kw):
        return json.dumps(kw, ensure_ascii=False) + "\n"

    def gen():
        try:
            engine, pieces = open_stream(messages)
        except RuntimeError as e:
            yield event(type="error", error=str(e))
            return
        except Exception:  # noqa: BLE001
            app.logger.exception("unexpected error starting detection stream")
            yield event(type="error", error="Something went wrong while analysing the image. Please try again.")
            return
        yield event(type="engine", engine=engine)
        buf, sent, found = "", 0, -1
        try:
            for piece in pieces:
                buf += piece
                if found < 0:
                    found = buf.find(NARRATION_MARK)
                    # Hold back a possible partial marker at the end of the buffer.
                    limit = found if found >= 0 else len(buf) - (len(NARRATION_MARK) - 1)
                    if limit > sent:
                        yield event(type="note", text=buf[sent:limit])
                        sent = limit
        except Exception as e:  # noqa: BLE001 - a mid-stream drop: use whatever arrived
            app.logger.warning("detection stream interrupted: %s: %s", type(e).__name__, e)
        raw = buf[found + len(NARRATION_MARK):] if found >= 0 else buf
        if found < 0 and sent < len(buf):
            yield event(type="note", text=buf[sent:])
        detections = detections_from_raw(raw)
        log_user_detections(detections, source, user_id)
        yield event(type="result", detections=detections, count=len(detections), engine=engine,
                    inference_ms=round((time.time() - t0) * 1000, 1))

    return Response(stream_with_context(gen()), mimetype="application/x-ndjson",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/stats")
def api_stats():
    return jsonify(db.get_stats(current_user_id()))


@app.route("/api/clear_history", methods=["POST"])
def api_clear_history():
    db.clear_history(current_user_id())
    return jsonify({"ok": True})


@app.route("/api/chatbot", methods=["POST"])
def api_chatbot():
    payload = request.get_json(silent=True) or {}
    history = payload.get("history") or []
    lang = payload.get("lang", "en")
    return jsonify(get_response(history, lang))


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
