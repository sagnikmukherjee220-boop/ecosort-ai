// scroll.js — shared scroll-linked reveal engine, loaded on every page.
// Unlike a threshold-triggered IntersectionObserver + fixed-duration CSS
// transition (which plays a timed animation once and can look out of sync
// with how fast someone is actually scrolling), this drives each element's
// opacity/translateY directly off its current position in the viewport,
// recomputed every animation frame while scrolling. Scroll fast, it reveals
// fast; scroll slow, it eases in slowly — it's tied to the input itself,
// which is what actually reads as "smooth". Reveal only ever runs forward:
// once an element fully arrives it's left alone, so scrolling back up
// doesn't fade already-seen content back out — you can always scroll up
// to see several revealed sections together.
window.EcoReveal = (() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const registered = [];
  let ticking = false;

  function update() {
    const vh = window.innerHeight;
    const start = vh * 0.94; // element top below this: fully hidden
    const end = vh * 0.55; // element top at/above this: fully revealed
    // Walk backwards so we can drop finished items from `registered`
    // in place without skipping the next one.
    for (let i = registered.length - 1; i >= 0; i--) {
      const { el, offset } = registered[i];
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) continue; // skip far-offscreen writes
      let p = (start - rect.top - offset) / (start - end);
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      const eased = 1 - Math.pow(1 - p, 3);
      el.style.opacity = eased;
      el.style.transform = `translateY(${(1 - eased) * 34}px)`;
      // Once an element has fully arrived, stop tracking it — it stays
      // visible for good from here on, even if the user scrolls back up
      // past it later. Reveal is a one-way "arrive once" effect, not a
      // constant tug-of-war with scroll position (which was the
      // "fades back out while scrolling up" complaint).
      if (p >= 1) {
        el.style.willChange = "";
        registered.splice(i, 1);
      }
    }
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  return {
    // Registers a NodeList/array of elements. `stagger` (ms-equivalent, in
    // px of extra scroll offset) staggers a group so they don't all arrive
    // in perfect lockstep — each element just needs a little more scroll
    // before it starts revealing than the one before it.
    bind(elements, { stagger = 0 } = {}) {
      const els = Array.from(elements || []);
      if (!els.length) return;
      if (reduceMotion) return; // leave fully visible, untouched
      els.forEach((el, i) => {
        el.style.willChange = "opacity, transform";
        registered.push({ el, offset: i * stagger });
      });
      update();
    },
  };
})();
