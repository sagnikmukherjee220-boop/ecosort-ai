(() => {
  const CATEGORY_COLORS = {
    biodegradable: "#4caf50",
    recyclable: "#2196f3",
    non_recyclable: "#757575",
    e_waste: "#ff9800",
    hazardous: "#e53935",
  };
  const CATEGORY_LABELS_FALLBACK = {
    biodegradable: "Biodegradable",
    recyclable: "Recyclable",
    non_recyclable: "Non-Recyclable",
    e_waste: "E-Waste",
    hazardous: "Hazardous",
  };
  function categoryLabel(key) {
    const fallback = CATEGORY_LABELS_FALLBACK[key] || key;
    return window.I18N ? window.I18N.t(`categories.${key}.label`, fallback) : fallback;
  }

  const BADGE_KEYS = {
    "Rookie Sorter": "badge_rookie",
    "Bronze Segregator": "badge_bronze",
    "Silver Segregator": "badge_silver",
    "Gold Segregator": "badge_gold",
    "Platinum Segregator": "badge_platinum",
  };
  function badgeLabel(name) {
    const key = BADGE_KEYS[name];
    if (!key || !window.I18N) return name;
    return window.I18N.t(`dashboard.${key}`, name);
  }

  let chart = null;

  async function loadStats() {
    const res = await fetch("/api/stats");
    const stats = await res.json();

    document.getElementById("totalPoints").textContent = stats.total_points;
    document.getElementById("totalItems").textContent = stats.total_items;
    document.getElementById("streak").textContent = stats.streak;
    document.getElementById("badgeName").textContent = badgeLabel(stats.badge);

    const labels = Object.keys(stats.by_category).map(categoryLabel);
    const values = Object.values(stats.by_category);
    const colors = Object.keys(stats.by_category).map((k) => CATEGORY_COLORS[k] || "#888");

    const ctx = document.getElementById("categoryChart");
    if (chart) chart.destroy();

    if (values.length === 0) {
      const emptyText = window.I18N ? window.I18N.t("dashboard.no_detections", "No detections yet — try the Detect page!") : "No detections yet — try the Detect page!";
      ctx.getContext("2d").font = "16px Segoe UI";
      ctx.getContext("2d").fillStyle = "#a9c4b6";
      ctx.getContext("2d").fillText(emptyText, 10, 100);
    } else {
      chart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }],
        },
        options: {
          plugins: {
            legend: { position: "bottom", labels: { color: "#eafff2" } },
          },
        },
      });
    }

    const tbody = document.getElementById("historyBody");
    tbody.innerHTML = "";
    stats.recent.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.ts.replace("T", " ")}</td><td style="text-transform:capitalize;">${r.coco_label}</td>
        <td>${categoryLabel(r.category)}</td><td>${Math.round(r.confidence * 100)}%</td><td>+${r.points}</td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById("clearBtn").addEventListener("click", async () => {
    const msg = window.I18N ? window.I18N.t("dashboard.reset_confirm", "Reset all detection history? This cannot be undone.") : "Reset all detection history? This cannot be undone.";
    if (!confirm(msg)) return;
    await fetch("/api/clear_history", { method: "POST" });
    loadStats();
  });

  // Re-render the chart/table labels when the language changes, so a
  // switch updates the whole dashboard, not just the static nav/labels.
  document.addEventListener("i18n:change", loadStats);

  loadStats();
})();
