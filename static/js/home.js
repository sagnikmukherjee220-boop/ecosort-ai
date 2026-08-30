// home.js — homepage-only polish: cards flow/fade in as they're scrolled
// into view, and the big crisis-stat numbers count up once visible.
// Purely decorative — never blocks or delays content, and backs off
// entirely for prefers-reduced-motion.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------- Scroll-in reveal for card groups ----------------
  if (!reduceMotion && "IntersectionObserver" in window) {
    const groups = [
      document.querySelectorAll(".big-stat-grid > .big-stat"),
      document.querySelectorAll(".compare-grid > .compare-row"),
      document.querySelectorAll(".stat-strip > .card"),
      document.querySelectorAll(".feature-grid > .card"),
    ];
    // A small negative bottom margin + low threshold means each card
    // starts gliding in a little before it's fully on screen, so by the
    // time it's actually in view the motion already reads as smooth
    // rather than a sudden pop-in.
    const revealIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealIO.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -60px 0px" }
    );
    groups.forEach((group) => {
      group.forEach((el, i) => {
        el.classList.add("reveal");
        el.style.transitionDelay = `${i * 100}ms`;
        revealIO.observe(el);
      });
    });
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
