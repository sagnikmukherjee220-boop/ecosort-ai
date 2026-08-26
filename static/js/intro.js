// intro.js — first-visit welcome slideshow on the homepage. Shown once per
// browser (localStorage flag), and skipped entirely if the server already
// knows the visitor is signed in.
(() => {
  const overlay = document.getElementById("introOverlay");
  if (!overlay) return; // not on the homepage

  const STORAGE_KEY = "ecosort_intro_seen";
  const loggedIn = document.body.dataset.loggedIn === "true";

  if (loggedIn || localStorage.getItem(STORAGE_KEY)) {
    overlay.remove();
    return;
  }

  const slides = Array.from(overlay.querySelectorAll(".intro-slide"));
  const dotsWrap = document.getElementById("introDots");
  const nextBtn = document.getElementById("introNext");
  const skipBtn = document.getElementById("introSkip");
  const guestBtn = document.getElementById("introGuestBtn");
  const googleBtn = document.getElementById("introGoogleBtn");

  let index = 0;

  slides.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "intro-dot";
    dot.addEventListener("click", () => goTo(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function goTo(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, si) => s.classList.toggle("active", si === index));
    dots.forEach((d, di) => d.classList.toggle("active", di === index));
    const isLast = index === slides.length - 1;
    nextBtn.style.display = isLast ? "none" : "";
    skipBtn.style.display = isLast ? "none" : "";
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    overlay.classList.add("intro-closing");
    setTimeout(() => overlay.remove(), 300);
  }

  nextBtn.addEventListener("click", () => goTo(index + 1));
  skipBtn.addEventListener("click", dismiss);
  guestBtn.addEventListener("click", dismiss);
  googleBtn.addEventListener("click", () => localStorage.setItem(STORAGE_KEY, "1"));

  goTo(0);
})();
