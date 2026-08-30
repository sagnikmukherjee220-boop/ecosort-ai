// home.js — homepage-only polish: cards flow/fade in as they're scrolled
// into view, and the big crisis-stat numbers count up once visible.
// Purely decorative — never blocks or delays content, and backs off
// entirely for prefers-reduced-motion.
(() => {
  // ---------------- Scroll-in reveal for card groups ----------------
  // Scroll-linked (via EcoReveal in scroll.js), not a fixed-duration
  // transition — motion tracks the scroll itself instead of a timed pop.
  if (window.EcoReveal) {
    window.EcoReveal.bind(document.querySelectorAll(".big-stat-grid > .big-stat"), { stagger: 90 });
    window.EcoReveal.bind(document.querySelectorAll(".compare-grid > .compare-row"), { stagger: 90 });
    window.EcoReveal.bind(document.querySelectorAll(".stat-strip > .card"), { stagger: 90 });
    window.EcoReveal.bind(document.querySelectorAll(".feature-grid > .card"), { stagger: 90 });
  }

  // ---------------- Count-up for the big crisis-stat numbers ----------------
  const nums = document.querySelectorAll(".big-num[data-count-to]");
  if (!nums.length) return;

  function animate(el) {
    const target = parseFloat(el.dataset.countTo);
    const suffix = el.dataset.suffix || "";
    const isDecimal = String(target).includes(".");
    const duration = 1100;
    const start = performance.now();

    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      // ease-out
      const eased = 1 - Math.pow(1 - p, 3);
      const value = target * eased;
      el.textContent = (isDecimal ? value.toFixed(2) : Math.round(value)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (!("IntersectionObserver" in window)) {
    nums.forEach(animate);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 }
  );
  nums.forEach((el) => io.observe(el));
})();
