// guidelines.js — tap-to-expand disposal steps per category card. Keeps
// each card compact/scannable at a glance (icon, points, examples) and
// only shows the dense step-by-step text once someone actually wants it.
(() => {
  document.querySelectorAll(".cat-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".cat-card");
      const open = card.classList.toggle("cat-open");
      const showText = window.I18N ? window.I18N.t("guidelines.show_details", "Show disposal steps ▾") : "Show disposal steps ▾";
      const hideText = window.I18N ? window.I18N.t("guidelines.hide_details", "Hide disposal steps ▴") : "Hide disposal steps ▴";
      btn.textContent = open ? hideText : showText;
    });
  });
})();
