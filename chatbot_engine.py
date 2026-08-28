"""
chatbot_engine.py — EcoBot's response logic.

Primary path: the same vision-language model used for detection (via
Hugging Face Inference Providers) answers freely, grounded by a short
system prompt built from data/chatbot_kb.json and the site's actual
category metadata — so it can handle open-ended, rephrased, or
follow-up questions instead of only matching a fixed pattern list.

Fallback path: if HF_TOKEN isn't set or the API call fails (offline
dev, quota exhausted, network hiccup), falls back to the original
keyword/fuzzy-match responder so the chatbot still answers *something*
rather than erroring out.
"""
import difflib
import json
import os
import re

import waste_map

KB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "chatbot_kb.json")

with open(KB_PATH, "r", encoding="utf-8") as f:
    _KB = json.load(f)

FALLBACK_RESPONSES = [
    "I'm not fully sure about that one. Try asking about biodegradable, recyclable, non-recyclable, e-waste or hazardous waste!",
    "Could you rephrase that? I can help with waste categories, disposal guidelines, eco-points, or how the detection model works.",
]

_hf_client = None
CHAT_MODEL = "meta-llama/Llama-4-Scout-17B-16E-Instruct"
CHAT_PROVIDER = "deepinfra"

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi",
}


def _get_hf_client():
    global _hf_client
    if _hf_client is None:
        from huggingface_hub import InferenceClient
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN environment variable is not set")
        _hf_client = InferenceClient(api_key=token, provider=CHAT_PROVIDER)
    return _hf_client


def _build_system_prompt(lang: str = "en"):
    facts = "\n".join(f"- {e['response']}" for e in _KB if e["id"] not in ("greeting", "thanks"))
    bins = ", ".join(f"{meta['label']} ({meta['bin']})" for meta in waste_map.CATEGORY_META.values())
    lang_name = LANG_NAMES.get(lang, "English")
    return (
        "You are EcoBot, a friendly assistant on the EcoSort AI waste-segregation website. "
        "Answer clearly, warmly, and concisely (2-4 short sentences, no long essays or "
        "markdown headers). "
        f"The site sorts waste into these categories: {bins}. "
        "Reference facts you can rely on for this site specifically:\n" + facts + "\n"
        "Beyond the site itself, you're also a knowledgeable, diversified sustainability "
        "assistant: happily answer broader questions on composting techniques, DIY reuse/"
        "upcycling ideas, general recycling practices, environmental facts, and eco-friendly "
        "living, not just the five categories above. You can have a normal back-and-forth "
        "conversation, including remembering what was said earlier in this chat. If asked "
        "something with no connection to waste, sustainability, or the site at all, answer "
        "briefly if you genuinely know it, otherwise say so honestly rather than guessing.\n"
        f"The user has set the site's language to {lang_name} — always reply in {lang_name}, "
        "regardless of which language they type their message in."
    )


MAX_HISTORY_MESSAGES = 12  # ~6 exchanges of context, enough to feel conversational without ballooning cost


def _ai_response(history: list, lang: str = "en") -> str:
    client = _get_hf_client()
    # `history` comes from the client (untrusted) — only pass through
    # well-formed user/assistant turns so it can't inject a fake system
    # message and override the prompt above.
    safe_history = [
        {"role": m["role"], "content": str(m["content"])[:2000]}
        for m in history
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")
    ][-MAX_HISTORY_MESSAGES:]

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[{"role": "system", "content": _build_system_prompt(lang)}] + safe_history,
        max_tokens=250,
    )
    return response.choices[0].message.content.strip()


def _tokenize(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def _rule_based_response(user_message: str) -> str:
    msg = user_message.lower().strip()
    if not msg:
        return "Ask me anything about waste segregation!"

    for entry in _KB:
        for pattern in entry["patterns"]:
            if pattern in msg:
                return entry["response"]

    tokens = _tokenize(msg)
    all_patterns = [(p, e) for e in _KB for p in e["patterns"]]
    best_score = 0.0
    best_entry = None
    for token in tokens:
        for pattern, entry in all_patterns:
            score = difflib.SequenceMatcher(None, token, pattern).ratio()
            if score > best_score:
                best_score = score
                best_entry = entry

    if best_entry and best_score > 0.78:
        return best_entry["response"]

    return FALLBACK_RESPONSES[0]


def get_response(history: list, lang: str = "en") -> dict:
    """`history` is a list of {"role": "user"|"assistant", "content": str}
    messages in order, ending with the latest user turn. `lang` is the
    site's currently selected UI language code (e.g. "hi") — the AI path
    replies in it explicitly; the rule-based fallback stays English-only
    (its canned responses aren't translated, unlike everything else)."""
    user_turns = [m for m in history if isinstance(m, dict) and m.get("role") == "user"]
    last_message = str(user_turns[-1].get("content", "")) if user_turns else ""
    if not last_message.strip():
        return {"reply": "Ask me anything about waste segregation!"}
    try:
        return {"reply": _ai_response(history, lang)}
    except Exception:
        return {"reply": _rule_based_response(last_message)}
