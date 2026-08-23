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
a vision-language model to identify *any* object a camera or photo shows it
and tell you exactly how to segregate it — Biodegradable, Recyclable,
Non-Recyclable, E-Waste, or Hazardous.

## Features

- **Open-vocabulary object identification** via a vision-language model
  (not limited to a fixed list of classes — it can name and classify
  things it was never explicitly trained to recognize)
- **Live webcam** and **photo upload** detection modes
- **5-category waste classification**, decided by the model and grounded
  in real municipal solid-waste guidelines
- **Voice guidance** (Web Speech API) reads out disposal instructions,
  in English, Hindi, Bengali, Tamil, Telugu, or Marathi
- **Full UI translation** with a language switcher in the navbar
- **Eco-points, streaks & badges** dashboard with a live chart
- **EcoBot** — a fully offline, rule-based chatbot for waste FAQs
- **Guidelines page** with detailed, accurate disposal information per category
- **Printable Impact Certificate** — a nice "wow" moment to show your examiner

## How it works (for your viva/report)

1. **Identification** — the captured frame is sent to a vision-language
   model (`meta-llama/Llama-4-Scout-17B-16E-Instruct`, hosted via Hugging
   Face's Inference Providers) with a prompt asking it to name every object
   it sees and assign each one to a waste category. This is genuinely
   open-vocabulary — unlike a fixed-class detector (e.g. YOLO trained on
   COCO's 80 classes), it can identify things far outside any predefined list.
2. **Category metadata** — `waste_map.py` owns what each of the five
   categories *means* (bin name, color, disposal tip, points) — the model
   only picks which category key applies; the presentation stays consistent
   and is the project's own reasoning/knowledge layer.
3. **Guidance** — the matched category's disposal tip is shown on screen,
   spoken aloud (in the selected language), and logged to a local database
   that powers the dashboard, eco-points, streaks and badges.

**Trade-off worth knowing for your viva:** this design needs an internet
connection and a Hugging Face API token at inference time — it is not fully
offline. The earlier YOLOv8-based version *was* fully offline but could only
recognize 80 fixed COCO classes; this version trades that offline-ness for
much broader, genuinely open-set recognition. Both are legitimate CV
architectures — pick whichever story fits your report better, or mention
both in the "design decisions" section as a considered trade-off. There's no
technical reason you couldn't reimplement the YOLO path from `waste_map.py`'s
git history if you wanted the offline story instead.

**Bounding boxes:** the vision-language model doesn't give reliable
pixel-accurate bounding boxes the way a dedicated detector does, so the UI
shows identified items as a list (name, category, bin, confidence) rather
than drawing boxes on the video/photo.

## 1. Setup (one-time)

You need **Python 3.9+** and a **Hugging Face account**.

1. Get an API token: `https://huggingface.co/settings/tokens/new` → Fine-grained
   → check **"Make calls to Inference Providers"** → Generate.
2. Enable at least one provider that serves the vision model: go to
   `https://huggingface.co/settings/inference-providers` and toggle on
   **DeepInfra** (used by default — see `VLM_PROVIDER` in `app.py`; any
   provider from that model's `inferenceProviderMapping` also works if you
   change the constant).
3. Open this folder in VS Code, open a terminal (`` Ctrl+` ``), and run:

```bash
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

## 2. Run the website

Set your token as an environment variable, then start the app:

```powershell
$env:HF_TOKEN = "hf_your_token_here"    # PowerShell
python app.py
```
```bash
export HF_TOKEN=hf_your_token_here      # macOS/Linux
python app.py
```

Open **http://127.0.0.1:5000** in your browser. Allow camera access when
prompted on the Detect page.

## 3. Deploy permanently (Render.com — free)

This repo includes a `Dockerfile` ready for Render's free Web Service tier:

1. Push this repo to GitHub.
2. On [render.com](https://render.com), **New +** → **Web Service** → connect
   the repo. Render auto-detects the `Dockerfile`. Instance Type: **Free**.
3. In the service's **Environment** tab, add a secret: `HF_TOKEN` = your
   Hugging Face token (never commit this to the repo).
4. Deploy. You'll get a permanent public URL that works from any device.

**Known limitations of the free tier:**
- Sleeps after ~15 minutes idle; the next visit takes ~30-60s to wake up.
  Visit the URL yourself a few minutes before you need it live (e.g. before
  a viva demo).
- 0.1 CPU is enough for this app (the heavy model inference happens on
  Hugging Face's servers, not Render's), but stay aware it's a shared
  free-tier box.

## Project Structure

```
app.py                   Flask app, API routes, vision-model prompt & call
waste_map.py              Waste-category metadata (bin, tip, color, points)
db.py                     SQLite history / points / streaks / badges
chatbot_engine.py         Offline rule-based chatbot logic
data/guidelines.json       Disposal guideline content
data/chatbot_kb.json       Chatbot knowledge base
templates/                Jinja2 HTML pages
static/css/style.css       Design system (glassmorphism, eco theme)
static/js/                 Detection loop, dashboard chart, chatbot UI, i18n
static/i18n/                Per-language UI translation JSON files
static/vendor/chart.umd.min.js   Chart.js, vendored locally (no CDN needed)
```

## Customising / Extending

- Add/edit waste-category metadata (bin name, tip, color, points) in
  `waste_map.py` → `CATEGORY_META`.
- Swap the vision model or provider by changing `VLM_MODEL` / `VLM_PROVIDER`
  in `app.py` — check a model's live providers at
  `https://huggingface.co/api/models/<model-id>?expand[]=inferenceProviderMapping`
  before switching, since not every provider serves every model reliably.
- Add a new UI language: copy `static/i18n/en.json` to `<code>.json` with
  translated values, add the language to the `LANGS` list in
  `static/js/i18n.js`, and add its name to `LANG_NAMES` in `app.py` (so the
  model knows what language to answer in).
- Add/edit chatbot Q&A pairs in `data/chatbot_kb.json`.
- Edit disposal guideline text in `data/guidelines.json`.

## Credits

Built with Flask, Hugging Face Inference Providers, and Chart.js.
Waste-segregation guidance is based on general municipal solid-waste
management practices.
