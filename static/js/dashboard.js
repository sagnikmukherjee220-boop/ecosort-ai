(() => {
  const CATEGORY_COLORS = {
    biodegradable: "#4caf50",
    recyclable: "#2196f3",
    non_recyclable: "#757575",
    e_waste: "#ff9800",
    hazardous: "#e53935",
  };
  const CATEGORY_LABELS = {
    biodegradable: "Biodegradable",
    recyclable: "Recyclable",
    non_recyclable: "Non-Recyclable",
    e_waste: "E-Waste",
    hazardous: "Hazardous",
  };

  let chart = null;

  async function loadStats() {
    const res = await fetch("/api/stats");
    const stats = await res.json();

    document.getElementById("totalPoints").textContent = stats.total_points;
    document.getElementById("totalItems").textContent = stats.total_items;
    document.getElementById("streak").textContent = stats.streak;
    document.getElementById("badgeName").textContent = stats.badge;

    const labels = Object.keys(stats.by_category).map((k) => CATEGORY_LABELS[k] || k);
    const values = Object.values(stats.by_category);
    const colors = Object.keys(stats.by_category).map((k) => CATEGORY_COLORS[k] || "#888");

    const ctx = document.getElementById("categoryChart");
    if (chart) chart.destroy();

    if (values.length === 0) {
      ctx.getContext("2d").font = "16px Segoe UI";
      ctx.getContext("2d").fillStyle = "#a9c4b6";
      ctx.getContext("2d").fillText("No detections yet — try the Detect page!", 10, 100);
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
        <td>${CATEGORY_LABELS[r.category] || r.category}</td><td>${Math.round(r.confidence * 100)}%</td><td>+${r.points}</td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById("clearBtn").addEventListener("click", async () => {
    if (!confirm("Reset all local detection history? This cannot be undone.")) return;
    await fetch("/api/clear_history", { method: "POST" });
    loadStats();
  });

  loadStats();
})();
