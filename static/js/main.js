// shared nav toggle for mobile
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
  }
});

// avatar dropdown (signed-in users)
(function () {
  var btn = document.getElementById("userMenuBtn"), dd = document.getElementById("userDropdown");
  if (!btn || !dd) return;
  function set(open) { dd.classList.toggle("open", open); btn.setAttribute("aria-expanded", open ? "true" : "false"); }
  btn.addEventListener("click", function (e) { e.stopPropagation(); set(!dd.classList.contains("open")); });
  document.addEventListener("click", function (e) { if (!dd.contains(e.target)) set(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
})();
