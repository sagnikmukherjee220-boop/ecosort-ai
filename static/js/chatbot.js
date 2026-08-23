(() => {
  const chatWindow = document.getElementById("chatWindow");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  function addMsg(text, who) {
    const div = document.createElement("div");
    div.className = `msg ${who}`;
    div.textContent = text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  async function send(text) {
    if (!text.trim()) return;
    addMsg(text, "user");
    input.value = "";
    const res = await fetch("/api/chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    setTimeout(() => addMsg(data.reply, "bot"), 260);
  }

  sendBtn.addEventListener("click", () => send(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send(input.value);
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => send(chip.dataset.q));
  });
})();
