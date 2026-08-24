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


def _get_hf_client():
    global _hf_client
    if _hf_client is None:
        from huggingface_hub import InferenceClient
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN environment variable is not set")
        _hf_client = InferenceClient(api_key=token, provider=CHAT_PROVIDER)
    return _hf_client


def _build_system_prompt():
    facts = "\n".join(f"- {e['response']}" for e in _KB if e["id"] not in ("greeting", "thanks"))
    bins = ", ".join(f"{meta['label']} ({meta['bin']})" for meta in waste_map.CATEGORY_META.values())
    return (
        "You are EcoBot, a friendly assistant on the EcoSort AI waste-segregation website. "
        "Answer waste-disposal, recycling, and site-usage questions clearly, warmly, and "
        "concisely (2-4 short sentences, no long essays or markdown headers). "
        f"The site sorts waste into these categories: {bins}. "
        "Reference facts you can rely on:\n" + facts + "\n"
        "If asked something unrelated to waste, recycling, or this site, answer briefly if you "
        "genuinely know it, otherwise gently steer the conversation back to waste segregation."
    )


def _ai_response(user_message: str) -> str:
    client = _get_hf_client()
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": user_message},
        ],
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


def get_response(user_message: str) -> dict:
    if not user_message.strip():
        return {"reply": "Ask me anything about waste segregation!"}
    try:
        return {"reply": _ai_response(user_message)}
    except Exception:
        return {"reply": _rule_based_response(user_message)}
