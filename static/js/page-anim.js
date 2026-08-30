// page-anim.js — site-wide scroll-in reveal for card-like sections outside
// the homepage (Guidelines, Detect, Dashboard, About). Loaded on every
// page from base.html; simply does nothing if a page has none of these
// containers. Uses the same .reveal/.in classes and easing as the
// homepage (see style.css + home.js) so the feel is consistent everywhere.
(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;

  const groups = [
    document.querySelectorAll(".dash-grid > .card"),          // Dashboard
    document.querySelectorAll(".category-grid > .cat-card"),  // Guidelines
    document.querySelectorAll(".about-steps > .card"),        // About
    document.querySelectorAll(".card.about-hero, .card.about-privacy"), // About
    document.querySelectorAll(".points-strip"),               // Guidelines + Detect
    document.querySelectorAll(".detect-layout .card"),        // Detect results panels
    document.querySelectorAll(".video-wrap"),                 // Detect camera/preview frame
  ];

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.05, rootMargin: "0px 0px -60px 0px" }
  );

  groups.forEach((group) => {
    group.forEach((el, i) => {
      el.classList.add("reveal");
      el.style.transitionDelay = `${i * 100}ms`;
      io.observe(el);
    });
  });
})();
