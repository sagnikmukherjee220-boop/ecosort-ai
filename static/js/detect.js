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
  const sensitivityBtns = document.getElementById("sensitivityBtns");

  const detList = document.getElementById("detList");
  const detCount = document.getElementById("detCount");

  let stream = null;
  let busy = false;
  let uploadedDataUrl = null;
  let capturedDataUrl = null; // frozen webcam frame, set once "Capture & Analyze" is clicked
  let currentConf = 0.35;
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

  // ---------------- Sensitivity presets (replaces raw numeric slider) ----------------
  // If a frame is already frozen/captured (webcam) or a photo is loaded
  // (upload), switching sensitivity re-analyzes that *same* image instead
  // of requiring a fresh capture — the whole point of freezing the frame.
  sensitivityBtns.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-conf]");
    if (!btn) return;
    currentConf = parseFloat(btn.dataset.conf);
    sensitivityBtns.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    if (capturedDataUrl) {
      const idle = window.I18N ? window.I18N.t("detect.retake", "Retake") : "Retake";
      runAnalysis(capturedDataUrl, "webcam", retakeBtn, idle);
    } else if (uploadedDataUrl) {
      const idle = window.I18N ? window.I18N.t("detect.analyze", "Analyze Photo") : "Analyze Photo";
      runAnalysis(uploadedDataUrl, "upload", analyzeBtn, idle);
    }
  });

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
  }

  retakeBtn.addEventListener("click", resumeLive);

  function grabFrame(source) {
    const c = document.createElement("canvas");
    c.width = source.videoWidth || source.naturalWidth;
    c.height = source.videoHeight || source.naturalHeight;
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  }

  // ---------------- Upload ----------------
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedDataUrl = e.target.result;
      uploadPreview.src = uploadedDataUrl;
      analyzeBtn.disabled = false;
      uploadPreview.onload = () => {
        overlay.width = uploadPreview.naturalWidth;
        overlay.height = uploadPreview.naturalHeight;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      };
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
  function renderDetections(detections, w, h, refEl, isNewCapture = true) {
    lastDetections = detections;
    lastRenderDims = { w, h };

    ctx.clearRect(0, 0, w, h);
    const hideIgnored = ignoreToggle.checked;
    const visible = hideIgnored ? detections.filter((d) => d.category !== "ignore") : detections;

    detCount.textContent = visible.length;
    detList.innerHTML = "";

    const emptyKey = video.style.display === "none" ? "detect.empty_state_upload" : "detect.empty_state_webcam";
    if (visible.length === 0) {
      const emptyText = window.I18N ? window.I18N.t(emptyKey) : "No waste items detected yet.";
      detList.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    }

    visible.forEach((d) => {
      const name = escapeHtml(objectName(d.label));
      const catLabel = escapeHtml(categoryField(d.category, "label", d.category_label));
      const bin = escapeHtml(categoryField(d.category, "bin", d.bin));

      // draw box — the vision model doesn't give reliable pixel-accurate
      // boxes, so d.box is null; only draw when one is actually present.
      if (d.box) {
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

      // list item
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
      detList.appendChild(row);
    });

    // read out every detected waste item (not just the top one) — this is
    // a one-shot batch per Capture & Analyze click, not a continuous
    // stream, so there's no risk of it babbling on repeatedly.
    const wasteOnly = detections.filter((d) => d.category !== "ignore");
    lastSpokenBatch = wasteOnly;
    if (isNewCapture && voiceEnabled && wasteOnly.length) {
      speakAllDetections(wasteOnly);
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
})();
