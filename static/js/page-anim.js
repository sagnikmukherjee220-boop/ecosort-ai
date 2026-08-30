// page-anim.js — site-wide scroll-in reveal for card-like sections outside
// the homepage (Guidelines, Detect, Dashboard, About). Loaded on every
// page from base.html; simply does nothing if a page has none of these
// containers. Motion is handled by scroll.js's EcoReveal (scroll-linked,
// not a timed transition) so the feel is identical to the homepage.
(() => {
  if (!window.EcoReveal) return;

  const groups = [
    document.querySelectorAll(".dash-grid > .card"),          // Dashboard
    document.querySelectorAll(".category-grid > .cat-card"),  // Guidelines
    document.querySelectorAll(".about-steps > .card"),        // About
    document.querySelectorAll(".card.about-hero, .card.about-privacy"), // About
    document.querySelectorAll(".points-strip"),               // Guidelines + Detect
    document.querySelectorAll(".detect-layout .card"),        // Detect results panels
    document.querySelectorAll(".video-wrap"),                 // Detect camera/preview frame
  ];

  groups.forEach((group) => window.EcoReveal.bind(group, { stagger: 90 }));
})();
