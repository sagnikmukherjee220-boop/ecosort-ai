(() => {
  const chatWindow = document.getElementById("chatWindow");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  // Conversation memory: kept client-side (resets on page reload) and sent
  // with every message so EcoBot can handle follow-ups like "what about the
  // lid?" instead of treating each message as a one-off, isolated question.
  let history = [];

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
    history.push({ role: "user", content: text });
    const res = await fetch("/api/chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
    });
    const data = await res.json();
    history.push({ role: "assistant", content: data.reply });
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
