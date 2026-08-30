// scroll.js — shared scroll-in reveal engine, loaded on every page.
//
// History: this used to bind opacity/transform directly to live scroll
// position every animation frame. That looked great scrolling straight
// down, but broke in two visible ways once stagger delays (needed so a
// row of 3-6 cards doesn't all pop at once) entered the picture: (1) if a
// user stopped scrolling before a *staggered* card's offset-delayed
// threshold was reached, it froze forever at whatever partial opacity it
// last computed — "too light to even start"; (2) because such a card was
// still being tracked, ANY later scroll (including scrolling back up)
// recomputed its opacity from the new position, making already-seen
// content fade or vanish while scrolling up.
//
// Fix: trigger once via IntersectionObserver, then hand off to a normal
// CSS transition. A CSS transition runs to completion on its own timer —
// it can't get stuck partway, and once it reaches opacity:1 we never
// touch that element's inline style again, so scrolling up can't undo it.
window.EcoReveal = (() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function bind(elements, { stagger = 70 } = {}) {
    const els = Array.from(elements || []);
    if (!els.length) return;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      return; // leave fully visible, untouched
    }

    els.forEach((el, i) => {
      const delay = Math.min(i, 6) * stagger; // cap so long rows don't drag out
      el.style.opacity = "0";
      el.style.transform = "translateY(34px)";
      el.style.transition =
        `opacity .9s cubic-bezier(.22,1,.36,1) ${delay}ms, ` +
        `transform .9s cubic-bezier(.22,1,.36,1) ${delay}ms`;
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.style.opacity = "1";
          entry.target.style.transform = "none";
          io.unobserve(entry.target); // done for good — never revisited
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  return { bind };
})();
