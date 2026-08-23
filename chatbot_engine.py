"""
chatbot_engine.py — a tiny, fully offline rule-based NLP chatbot.

No external API keys, no internet dependency, no cost — perfect for a
board-exam demo where you cannot risk relying on flaky wifi. It uses
simple keyword/substring matching plus difflib fuzzy matching as a
fallback, which is enough to reliably answer waste-segregation FAQs
and is easy to explain to an examiner (tokenize -> match intent ->
respond).
"""
import json
import os
import re
import difflib

KB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "chatbot_kb.json")

with open(KB_PATH, "r", encoding="utf-8") as f:
    _KB = json.load(f)

FALLBACK_RESPONSES = [
    "I'm not fully sure about that one. Try asking about biodegradable, recyclable, non-recyclable, e-waste or hazardous waste!",
    "Could you rephrase that? I can help with waste categories, disposal guidelines, eco-points, or how the detection model works.",
]


def _tokenize(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def get_response(user_message: str) -> dict:
    msg = user_message.lower().strip()
    if not msg:
        return {"reply": "Ask me anything about waste segregation!", "matched": None}

    # 1. direct substring match against known patterns (most reliable)
    for entry in _KB:
        for pattern in entry["patterns"]:
            if pattern in msg:
                return {"reply": entry["response"], "matched": entry["id"]}

    # 2. fuzzy match on tokens as a fallback (handles typos / rephrasing)
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
        return {"reply": best_entry["response"], "matched": best_entry["id"]}

    return {"reply": FALLBACK_RESPONSES[0], "matched": None}
