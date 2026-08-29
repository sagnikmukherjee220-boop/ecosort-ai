// detect.js — webcam capture loop + upload flow + overlay drawing + TTS
(() => {
  const video = document.getElementById("webcam");
  const overlay = document.getElementById("overlay");
  const ctx = overlay.getContext("2d");
  const uploadPreview = document.getElementById("uploadPreview");

  const tabWebcam = document.getElementById("tabWebcam");
  const tabUpload = document.getElementById("tabUpload");
  const webcamControls = document.getElementById("webcamControls");
  const uploadControls = document.getElementById("uploadControls");

  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const captureBtn = document.getElementById("captureBtn");
  const retakeBtn = document.getElementById("retakeBtn");
  const fileInput = document.getElementById("fileInput");
  const analyzeBtn = document.getElementById("analyzeBtn");

  const voiceBtn = document.getElementById("voiceBtn");
  const voiceIconOn = voiceBtn.querySelector(".icon-on");
  const voiceIconOff = voiceBtn.querySelector(".icon-off");
  const ignoreToggle = document.getElementById("ignoreToggle");

  const detList = document.getElementById("detList");
  const detCount = document.getElementById("detCount");
  const otherCard = document.getElementById("otherCard");
  const otherList = document.getElementById("otherList");
  const otherCount = document.getElementById("otherCount");

  let stream = null;
  let busy = false;
  let uploadedDataUrl = null;
  let capturedDataUrl = null; // frozen webcam frame, set once "Capture & Analyze" is clicked
  // Fixed at a balanced middle-ground threshold — the old Low/Medium/High
  // picker asked users to make a judgment call they had no way to evaluate,
  // so it's gone; this value is the "Medium" preset that worked well for most shots.
  const currentConf = 0.35;
  let lastDetections = []; // re-rendered when the language changes
  let lastRenderDims = null;
  let voiceEnabled = true;
  let lastSpokenBatch = [];

  // ---------------- Voice play/pause button ----------------
  // Tap to mute/unmute. If speech is currently playing, tapping stops it
  // right away (pause behavior). If voice is off and there's a previous
  // batch of results, turning it back on replays all of them.
  function updateVoiceBtnIcon() {
    voiceIconOn.style.display = voiceEnabled ? "" : "none";
    voiceIconOff.style.display = voiceEnabled ? "none" : "";
    voiceBtn.setAttribute("aria-pressed", String(voiceEnabled));
    voiceBtn.classList.toggle("active", voiceEnabled);
  }
  voiceBtn.addEventListener("click", () => {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      voiceEnabled = false;
    } else {
      voiceEnabled = !voiceEnabled;
      if (voiceEnabled && lastSpokenBatch.length) {
        speakAllDetections(lastSpokenBatch);
      }
    }
    updateVoiceBtnIcon();
  });
  updateVoiceBtnIcon();

  // ---------------- Tab switching ----------------
  function showWebcamTab() {
    tabWebcam.classList.add("active");
    tabUpload.classList.remove("active");
    webcamControls.style.display = "flex";
    uploadControls.style.display = "none";
    video.style.display = "block";
    uploadPreview.style.display = "none";
    stopAnalyzeUpload();
  }
  function showUploadTab() {
    tabUpload.classList.add("active");
    tabWebcam.classList.remove("active");
    uploadControls.style.display = "flex";
    webcamControls.style.display = "none";
    video.style.display = "none";
    uploadPreview.style.display = "block";
    stopCamera();
  }
  tabWebcam.addEventListener("click", showWebcamTab);
  tabUpload.addEventListener("click", showUploadTab);

  // ---------------- Webcam ----------------
  // Detection now calls a paid, rate-limited cloud API per shot (instead of
  // free local inference), so the camera stream is just for framing —
  // analysis only runs when the user taps "Capture & Analyze", not on a
  // continuous auto-loop.
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      captureBtn.disabled = false;
      video.onloadedmetadata = () => {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      };
    } catch (err) {
      alert("Could not access webcam: " + err.message);
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    captureBtn.disabled = true;
    resumeLive();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", stopCamera);

  // Freeze the current frame instead of re-grabbing a fresh one on every
  // click, so switching "Detection sensitivity" afterwards re-analyzes the
  // *same* shot rather than needing the object held in place again.
  captureBtn.addEventListener("click", async () => {
    if (!stream || busy) return;
    capturedDataUrl = grabFrame(video);
    video.pause();
    const idle = window.I18N ? window.I18N.t("detect.capture_analyze", "Capture & Analyze") : "Capture & Analyze";
    await runAnalysis(capturedDataUrl, "webcam", captureBtn, idle);
    captureBtn.style.display = "none";
    retakeBtn.style.display = "";
  });

  function resumeLive() {
    capturedDataUrl = null;
    captureBtn.style.display = "";
    retakeBtn.style.display = "none";
    if (stream) video.play();
    detCount.textContent = "0";
    const emptyText = window.I18N ? window.I18N.t("detect.empty_state_webcam") : "Start the camera or upload a photo to see detections here.";
    detList.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    otherCard.style.display = "none";
    otherList.innerHTML = "";
    otherCount.textContent = "0";
    lastDetections = [];
    lastRenderDims = null;
  }

  retakeBtn.addEventListener("click", resumeLive);

  // Cap the longest side before ever sending an image anywhere — phone
  // photos in particular can be 3000-4000px+, which needlessly slows both
  // the upload and the model's own processing on a busy multi-object shot.
  // 1280px is comfortably above what hosted vision models use internally
  // anyway, so this doesn't cost accuracy.
  const MAX_IMAGE_DIM = 1280;

  function drawScaled(source, srcW, srcH) {
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(srcW, srcH));
    const c = document.createElement("canvas");
    c.width = Math.round(srcW * scale);
    c.height = Math.round(srcH * scale);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    // Quality 0.92 (was 0.7) — the extra compression was blurring fine
    // detail like small text/logos on packaging, contributing to
    // misidentifications; the size cap above is what actually keeps
    // payload/latency down, so this can stay high without a tradeoff.
    return c.toDataURL("image/jpeg", 0.92);
  }

  function grabFrame(source) {
    return drawScaled(source, source.videoWidth || source.naturalWidth, source.videoHeight || source.naturalHeight);
  }

  // ---------------- Upload ----------------
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        uploadedDataUrl = drawScaled(img, img.naturalWidth, img.naturalHeight);
        uploadPreview.src = uploadedDataUrl;
        analyzeBtn.disabled = false;
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        overlay.width = Math.round(img.naturalWidth * scale);
        overlay.height = Math.round(img.naturalHeight * scale);
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  analyzeBtn.addEventListener("click", () => {
    const idle = window.I18N ? window.I18N.t("detect.analyze", "Analyze Photo") : "Analyze Photo";
    runAnalysis(uploadedDataUrl, "upload", analyzeBtn, idle);
  });

  function stopAnalyzeUpload() {
    uploadedDataUrl = null;
    analyzeBtn.disabled = true;
    fileInput.value = "";
  }

  // ---------------- API call ----------------
  // Shared by: first webcam capture, re-analyzing a frozen/uploaded frame
  // when sensitivity changes, and the upload-mode Analyze button. Shows its
  // loading state on whichever button is actually visible at the time
  // (capture vs. retake vs. analyze), not necessarily the one clicked.
  async function runAnalysis(dataUrl, source, loadingBtn, idleText) {
    if (!dataUrl || busy) return;
    busy = true;
    const wasDisabled = loadingBtn.disabled;
    loadingBtn.disabled = true;
    loadingBtn.textContent = window.I18N ? window.I18N.t("detect.analyzing", "Analyzing...") : "Analyzing...";
    try {
      const data = await sendForDetection(dataUrl, source);
      renderDetections(data.detections, overlay.width, overlay.height);
    } catch (e) {
      alert("Detection failed: " + e.message);
    }
    busy = false;
    loadingBtn.disabled = wasDisabled;
    loadingBtn.textContent = idleText;
    // Guard against the camera having been stopped while this request was
    // in flight — don't let a stale response re-enable a dead capture button.
    if (source === "webcam" && !stream) loadingBtn.disabled = true;
  }

  async function sendForDetection(dataUrl, source) {
    const lang = window.I18N ? window.I18N.lang : "en";
    const res = await fetch(`/api/detect?conf=${currentConf}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, source, lang }),
    });
    if (!res.ok) throw new Error("server error " + res.status);
    return res.json();
  }

  // ---------------- Translation helpers ----------------
  // Object names now come back from the vision model already written in
  // the requested language, so no local objects.json lookup is needed.
  function objectName(label) {
    return label;
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function categoryField(category, field, fallback) {
    if (!window.I18N) return fallback;
    return window.I18N.t(`categories.${category}.${field}`, fallback);
  }

  // ---------------- Rendering ----------------
  // Waste items and non-waste ("ignore") objects are always split into two
  // separate lists — never merged into one — so a person scanning the
  // results never has to double-check which bucket an item landed in.
  function buildListItem(d) {
    const name = escapeHtml(objectName(d.label));
    const catLabel = escapeHtml(categoryField(d.category, "label", d.category_label));
    const bin = escapeHtml(categoryField(d.category, "bin", d.bin));
    const row = document.createElement("div");
    row.className = "det-item";
    row.innerHTML = `
      <span class="dot" style="background:${d.color}"></span>
      <div>
        <div class="name">${name}</div>
        <div class="meta">${catLabel} &middot; ${bin}</div>
      </div>
      <div class="conf">${Math.round(d.confidence * 100)}%</div>
    `;
    return row;
  }

  function drawBox(d, w) {
    // draw box — the vision model doesn't give reliable pixel-accurate
    // boxes, so d.box is null; only draw when one is actually present.
    if (!d.box) return;
    const name = escapeHtml(objectName(d.label));
    const catLabel = escapeHtml(categoryField(d.category, "label", d.category_label));
    const [x1, y1, x2, y2] = d.box;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = d.color;
    const text = `${name} · ${catLabel}`;
    ctx.font = `${Math.max(13, w / 55)}px Segoe UI, sans-serif`;
    const textW = ctx.measureText(text).width + 10;
    ctx.fillRect(x1, Math.max(0, y1 - 22), textW, 22);
    ctx.fillStyle = "#04140b";
    ctx.fillText(text, x1 + 5, Math.max(15, y1 - 6));
  }

  function renderDetections(detections, w, h, refEl, isNewCapture = true) {
    lastDetections = detections;
    lastRenderDims = { w, h };

    ctx.clearRect(0, 0, w, h);
    detections.forEach((d) => drawBox(d, w));

    const wasteItems = detections.filter((d) => d.category !== "ignore");
    const otherItems = detections.filter((d) => d.category === "ignore");

    // Waste list
    detCount.textContent = wasteItems.length;
    detList.innerHTML = "";
    if (wasteItems.length === 0) {
      const emptyKey = video.style.display === "none" ? "detect.empty_state_upload" : "detect.empty_state_webcam";
      const emptyText = window.I18N ? window.I18N.t(emptyKey) : "No waste items detected yet.";
      detList.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    } else {
      wasteItems.forEach((d) => detList.appendChild(buildListItem(d)));
    }

    // Non-waste list — its own card, shown only when the toggle is on and
    // there's actually something in it, so it never sits there empty.
    const showOther = ignoreToggle.checked && otherItems.length > 0;
    otherCard.style.display = showOther ? "" : "none";
    otherCount.textContent = otherItems.length;
    otherList.innerHTML = "";
    otherItems.forEach((d) => otherList.appendChild(buildListItem(d)));

    // read out every detected waste item (not just the top one) — this is
    // a one-shot batch per Capture & Analyze click, not a continuous
    // stream, so there's no risk of it babbling on repeatedly.
    lastSpokenBatch = wasteItems;
    if (isNewCapture && voiceEnabled && wasteItems.length) {
      speakAllDetections(wasteItems);
    }
  }

  function speakAllDetections(items) {
    const introWord = window.I18N ? window.I18N.t("detect.speak_this_is", "This is") : "This is";
    const text = items
      .map((d) => {
        const name = objectName(d.label);
        const catLabel = categoryField(d.category, "label", d.category_label);
        return `${name}. ${introWord} ${catLabel}.`;
      })
      .join(" ");
    speak(text);
  }

  function pickVoice(langCode) {
    if (!("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const prefix = (langCode || "en").split("-")[0];
    return (
      voices.find((v) => v.lang === langCode) ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) ||
      null
    );
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voiceLang = (window.I18N && window.I18N.dict.meta && window.I18N.dict.meta.voice) || "en-IN";
    utter.lang = voiceLang;
    const voice = pickVoice(voiceLang);
    if (voice) utter.voice = voice;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }

  // Re-render with translated labels when the language changes, so
  // switching language mid-session updates everything already on screen.
  // Doesn't auto-speak — that would be surprising just from switching a
  // dropdown; use the voice button to hear it in the new language.
  document.addEventListener("i18n:change", () => {
    if (lastRenderDims) {
      renderDetections(lastDetections, lastRenderDims.w, lastRenderDims.h, undefined, false);
    }
  });

  // Toggling "Also show non-waste objects" just reveals/hides the second
  // card — it never merges its contents into the waste list.
  ignoreToggle.addEventListener("change", () => {
    if (lastRenderDims) {
      renderDetections(lastDetections, lastRenderDims.w, lastRenderDims.h, undefined, false);
    }
  });
})();
