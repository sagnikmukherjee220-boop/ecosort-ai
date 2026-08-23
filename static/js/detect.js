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
  const fileInput = document.getElementById("fileInput");
  const analyzeBtn = document.getElementById("analyzeBtn");

  const voiceToggle = document.getElementById("voiceToggle");
  const ignoreToggle = document.getElementById("ignoreToggle");
  const sensitivityBtns = document.getElementById("sensitivityBtns");

  const detList = document.getElementById("detList");
  const detCount = document.getElementById("detCount");

  let stream = null;
  let busy = false;
  let lastSpokenLabel = null;
  let uploadedDataUrl = null;
  let currentConf = 0.35;
  let lastDetections = []; // re-rendered when the language changes
  let lastRenderDims = null;

  // ---------------- Sensitivity presets (replaces raw numeric slider) ----------------
  sensitivityBtns.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-conf]");
    if (!btn) return;
    currentConf = parseFloat(btn.dataset.conf);
    sensitivityBtns.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
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
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  startBtn.addEventListener("click", startCamera);
  stopBtn.addEventListener("click", stopCamera);

  captureBtn.addEventListener("click", async () => {
    if (!stream || busy) return;
    busy = true;
    captureBtn.disabled = true;
    captureBtn.textContent = window.I18N ? window.I18N.t("detect.analyzing", "Analyzing...") : "Analyzing...";
    const dataUrl = grabFrame(video);
    try {
      const data = await sendForDetection(dataUrl, "webcam");
      renderDetections(data.detections, overlay.width, overlay.height);
    } catch (e) {
      alert("Detection failed: " + e.message);
    }
    busy = false;
    captureBtn.disabled = !stream;
    captureBtn.textContent = window.I18N ? window.I18N.t("detect.capture_analyze", "Capture & Analyze") : "Capture & Analyze";
  });

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

  analyzeBtn.addEventListener("click", async () => {
    if (!uploadedDataUrl) return;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = window.I18N ? window.I18N.t("detect.analyzing", "Analyzing...") : "Analyzing...";
    try {
      const data = await sendForDetection(uploadedDataUrl, "upload");
      renderDetections(data.detections, overlay.width, overlay.height, uploadPreview);
    } catch (e) {
      alert("Detection failed: " + e.message);
    }
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = window.I18N ? window.I18N.t("detect.analyze", "Analyze Photo") : "Analyze Photo";
  });

  function stopAnalyzeUpload() {
    uploadedDataUrl = null;
    analyzeBtn.disabled = true;
    fileInput.value = "";
  }

  // ---------------- API call ----------------
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
  function renderDetections(detections, w, h, refEl) {
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

    // speak the most confident *new* waste item
    const wasteOnly = detections.filter((d) => d.category !== "ignore");
    if (wasteOnly.length && voiceToggle.checked) {
      const top = wasteOnly.reduce((a, b) => (a.confidence > b.confidence ? a : b));
      const key = top.label + top.category;
      if (key !== lastSpokenLabel) {
        lastSpokenLabel = key;
        speakDetection(top);
      }
    }
  }

  function speakDetection(d) {
    const name = objectName(d.label);
    const catLabel = categoryField(d.category, "label", d.category_label);
    const tip = categoryField(d.category, "tip", d.tip);
    const introWord = window.I18N ? window.I18N.t("detect.speak_this_is", "This is") : "This is";
    speak(`${name}. ${introWord} ${catLabel}. ${tip}`);
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

  // Re-render with translated labels (and re-speak in the new voice) when the
  // language changes, so switching language mid-session updates everything
  // already on screen instead of only future detections.
  document.addEventListener("i18n:change", () => {
    if (lastRenderDims) {
      renderDetections(lastDetections, lastRenderDims.w, lastRenderDims.h);
    }
  });
})();
