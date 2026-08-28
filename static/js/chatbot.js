(() => {
  const chatWindow = document.getElementById("chatWindow");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const newChatBtn = document.getElementById("newChatBtn");

  const STORAGE_KEY = "ecosort_ecobot_history";
  const GREETING = "Hi! I'm EcoBot 🤖. Ask me about any waste category, or how the detection system works.";

  // Conversation memory: persisted to sessionStorage (survives navigating
  // away and back, or an accidental reload, within this browser tab; clears
  // when the tab/browser closes) and sent with every message so EcoBot can
  // handle follow-ups like "what about the lid?" instead of treating each
  // message as a one-off, isolated question. A plain in-memory variable
  // used to reset on any page reload — the chat window would go back to
  // just the greeting, silently losing everything said before it, which
  // read as "the bot forgot" even though nothing about the memory logic
  // itself was broken.
  let history = loadHistory();
  replayHistory();

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      // storage unavailable (private mode, quota, etc.) — chat still works
      // for the current page view, it just won't survive a reload.
    }
  }

  function replayHistory() {
    history.forEach((m) => addMsg(m.content, m.role === "user" ? "user" : "bot"));
  }

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
    saveHistory();
    const res = await fetch("/api/chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
    });
    const data = await res.json();
    history.push({ role: "assistant", content: data.reply });
    saveHistory();
    setTimeout(() => addMsg(data.reply, "bot"), 260);
  }

  sendBtn.addEventListener("click", () => send(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send(input.value);
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => send(chip.dataset.q));
  });

  newChatBtn.addEventListener("click", () => {
    history = [];
    saveHistory();
    chatWindow.innerHTML = `<div class="msg bot">${GREETING}</div>`;
  });
})();
