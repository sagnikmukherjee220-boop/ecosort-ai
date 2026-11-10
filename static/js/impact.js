// impact.js — slide-out Impact tracker (community totals incl. guests).
(function () {
  var tab = document.getElementById("impactTab"), panel = document.getElementById("impactPanel");
  if (!tab || !panel) return;
  var timer = null, last = null;
  var nf = function (n) { return Number(n).toLocaleString("en-IN"); };
  var t = function (k, fb) { return (window.I18N && I18N.t) ? I18N.t(k, fb) : fb; };

  function set(open) {
    panel.classList.toggle("open", open);
    tab.classList.toggle("open", open);
    tab.setAttribute("aria-expanded", open ? "true" : "false");
    clearInterval(timer);
    if (open) { load(); timer = setInterval(load, 30000); }
  }

  function render(d) {
    last = d;
    document.getElementById("impItems").textContent = nf(d.items);
    document.getElementById("impKg").textContent = nf(d.kg_diverted) + " kg";
    document.getElementById("impCo2").textContent = nf(d.co2_kg) + " kg";
    document.getElementById("impTrees").textContent = Number(d.trees).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    var max = Math.max.apply(null, d.week.map(function (w) { return w.count; }).concat([1]));
    document.getElementById("impWeek").innerHTML = d.week.map(function (w) {
      return '<div class="wk"><i style="height:' + Math.max(4, Math.round(100 * w.count / max)) + '%" title="' + w.count + '"></i><small>' + w.day + "</small></div>";
    }).join("");
    var cmax = Math.max.apply(null, d.categories.map(function (c) { return c.count; }).concat([1]));
    var cats = d.items ? d.categories : [];
    document.getElementById("impCats").innerHTML = cats.length ? cats.map(function (c) {
      return '<div class="cat"><span>' + c.label + '</span><div><i style="width:' + Math.round(100 * c.count / cmax) + "%;background:" + c.color + '"></i></div><b>' + nf(c.count) + "</b></div>";
    }).join("") : '<p class="impact-empty">' + t("impact.empty", "No items sorted yet — be the first!") + "</p>";
    var you = document.getElementById("impYou");
    if (d.logged_in) {
      var line1 = t("impact.yours_text", "You've sorted {n} items — {pct}% of the community's {total}.")
        .replace("{n}", nf(d.mine)).replace("{total}", nf(d.items)).replace("{pct}", d.pct);
      var line2 = t("impact.yours_est", "≈ {kg} kg diverted from landfill · {co2} kg CO₂ avoided")
        .replace("{kg}", nf(d.mine_kg)).replace("{co2}", nf(d.mine_co2));
      you.innerHTML = "<h4>" + t("impact.yours", "Your impact") + "</h4><p>" + line1 + '</p><p class="est">' + line2 + "</p>";
    } else {
      you.innerHTML = '<p class="hint">' + t("impact.signin_hint", "Sign in to see your own share.") + "</p>";
    }
  }

  function load() {
    fetch("/api/impact", { cache: "no-store" }).then(function (r) { return r.json(); }).then(render).catch(function () {});
  }

  tab.addEventListener("click", function () { set(!panel.classList.contains("open")); });
  document.getElementById("impactClose").addEventListener("click", function () { set(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
  document.addEventListener("click", function (e) { if (panel.classList.contains("open") && !panel.contains(e.target) && !tab.contains(e.target)) set(false); });
  document.addEventListener("i18n:change", function () { if (last) render(last); });
  document.addEventListener("ecosort:detected", function () { if (panel.classList.contains("open")) load(); });
})();
