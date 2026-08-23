---
title: EcoSort AI
emoji: ♻️
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# EcoSort AI — Smart Waste Segregation Website

A Class XII Computer Science / AI investigatory project: a web app that uses
real-time computer vision (multi-object detection) and a rule-based
classification engine to identify waste items and tell you exactly how to
segregate them — Biodegradable, Recyclable, Non-Recyclable, E-Waste, or
Hazardous.

Runs **entirely on your own machine** in VS Code — no Google Colab, no
third-party AI API, no external hosting. You control the server, and you
control if/when it's exposed publicly (via your own `localtunnel` link).

## Features

- **Live multi-object detection** via webcam (YOLOv8, Ultralytics)
- **Photo upload** detection mode
- **5-category waste classification** with a transparent rule-based mapping engine
- **Voice guidance** (Web Speech API) reads out disposal instructions
- **Eco-points, streaks & badges** dashboard with a live chart
- **EcoBot** — a fully offline, rule-based chatbot for waste FAQs
- **Guidelines page** with detailed, accurate disposal information per category
- **Printable Impact Certificate** — a nice "wow" moment to show your examiner
- Fully local SQLite history — nothing leaves your machine

## 1. Setup (one-time)

You need **Python 3.9+**. Open this folder in VS Code, open a terminal
(`` Ctrl+` ``), and run:

```bash
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

> The first time you run the app, `ultralytics` will auto-download the
> `yolov8n.pt` weights file (~6 MB) — you need internet **once** for this.
> After that it's cached locally and the app works fully offline.

## 2. Run the website

```bash
python app.py
```

Open **http://127.0.0.1:5000** in your browser. Allow camera access when
prompted on the Detect page.

## 3. (Optional) Share it publicly with localtunnel — you stay in control

In a **second terminal**, while `app.py` is still running:

```bash
npm install -g localtunnel
lt --port 5000
```

This prints a public URL (e.g. `https://xyz.loca.lt`) that tunnels to your
own laptop — nothing is uploaded anywhere, and you can kill the tunnel any
time with `Ctrl+C`. Perfect for demoing to an external examiner from your
own machine without deploying to any cloud service.

## 4. Deploy permanently (Hugging Face Spaces — free)

To have this reachable from any device, anywhere, without your laptop
staying on, deploy it to [Hugging Face Spaces](https://huggingface.co/spaces)
using the included `Dockerfile`:

1. Create a free Hugging Face account, then create a new Space:
   **Space SDK → Docker**, visibility public or private, any name.
2. Push this whole project folder to the Space's git repo (Spaces gives you
   a `git remote` URL on creation):
   ```bash
   git init
   git remote add space https://huggingface.co/spaces/<your-username>/<space-name>
   git add .
   git commit -m "Deploy EcoSort AI"
   git push space main
   ```
3. The Space builds the `Dockerfile` automatically and gives you a permanent
   URL like `https://<your-username>-<space-name>.hf.space` that works from
   any device, on any network — no firewall or router config needed.

**Two things to know about the free tier:**
- The container **sleeps after a period of inactivity** and wakes back up
  (~20–30s cold start) on the next visit — normal for free hosting, not a bug.
- The **SQLite history resets** whenever the Space restarts/rebuilds, since
  free Spaces storage is ephemeral. The eco-points/streaks/dashboard will
  start fresh after a sleep-wake cycle. If you need that to persist, enable
  a **Persistent Storage** add-on on the Space settings page (paid) and
  point `db.py`'s `DB_PATH` at the mounted `/data` directory instead.

## Project Structure

```
app.py                 Flask app & API routes
waste_map.py            COCO-class -> waste-category rule engine
db.py                    SQLite history / points / streaks / badges
chatbot_engine.py        Offline rule-based chatbot logic
data/guidelines.json      Disposal guideline content
data/chatbot_kb.json      Chatbot knowledge base
templates/               Jinja2 HTML pages
static/css/style.css      Design system (glassmorphism, eco theme)
static/js/                Detection loop, dashboard chart, chatbot UI
static/vendor/chart.umd.min.js   Chart.js, vendored locally (no CDN needed)
```

## How the CV pipeline works (for your viva/report)

1. **Detection** — YOLOv8n (pretrained on the 80-class COCO dataset) finds
   every object in a frame with a bounding box + confidence score. This is
   the *multi-object detection* stage — genuinely real-time, robust,
   industry-grade CV, no training required.
2. **Classification** — `waste_map.py` maps each detected object (e.g.
   `"cell phone"`, `"banana"`, `"bottle"`) to one of five waste categories
   using a rule engine grounded in real municipal solid-waste guidelines.
   This is the project's own classification/reasoning layer.
3. **Guidance** — the matched category's disposal tip is shown on screen,
   spoken aloud, and logged to a local database that powers the dashboard,
   eco-points, streaks and badges.

This "pretrained detector + custom reasoning layer" design is intentional:
it is the same detect-then-reason architecture used in real AI-guided
material-recovery facilities, and it stays reliable during a live demo
instead of risking a fragile, under-trained custom model.

## Customising / Extending

- Add/edit waste-category mappings in `waste_map.py` → `COCO_TO_WASTE`.
- Add/edit chatbot Q&A pairs in `data/chatbot_kb.json`.
- Edit disposal guideline text in `data/guidelines.json`.
- Want a *custom-trained* classifier on top (e.g. to tell recyclable
  plastic apart from recyclable glass)? Train a small image classifier
  (e.g. MobileNetV2 transfer learning on a dataset like TrashNet) and plug
  its prediction in as a second pass inside `run_detection()` in `app.py`.

## Credits

Built with Flask, Ultralytics YOLOv8, and Chart.js. Waste-segregation
guidance is based on general municipal solid-waste management practices.
