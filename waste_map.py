"""
waste_map.py
--------------------------------------------------------------------
Category metadata for the five waste-segregation buckets used across
the whole app (bin name, color, points, disposal tip).

The *classification* itself (deciding which category an arbitrary,
open-vocabulary object belongs to) is done by the vision-language
model in app.py's run_detection() — the model is prompted to choose
directly from these category keys. This module just owns what each
category means and how it's presented, so that meaning stays
consistent regardless of which object triggered it.
--------------------------------------------------------------------
"""

BIODEGRADABLE = "biodegradable"
RECYCLABLE = "recyclable"
NON_RECYCLABLE = "non_recyclable"
E_WASTE = "e_waste"
HAZARDOUS = "hazardous"
IGNORE = "ignore"  # model judged the object isn't a waste item at all

CATEGORY_META = {
    BIODEGRADABLE: {
        "label": "Biodegradable",
        "color": "#4caf50",
        "bin": "Green Bin",
        "icon": "leaf",
        "points": 10,
        "tip": "Compostable organic waste. Breaks down naturally.",
    },
    RECYCLABLE: {
        "label": "Recyclable (Dry Waste)",
        "color": "#2196f3",
        "bin": "Blue Bin",
        "icon": "recycle",
        "points": 10,
        "tip": "Clean paper, plastic, glass or metal that can be reprocessed.",
    },
    NON_RECYCLABLE: {
        "label": "Non-Recyclable (Reject Waste)",
        "color": "#757575",
        "bin": "Black Bin",
        "icon": "trash",
        "points": 5,
        "tip": "Mixed-material or soiled waste that cannot be recycled or composted.",
    },
    E_WASTE: {
        "label": "E-Waste",
        "color": "#ff9800",
        "bin": "E-Waste Collection Point",
        "icon": "cpu",
        "points": 20,
        "tip": "Electronic/electrical items. Contains recoverable metals and toxic components.",
    },
    HAZARDOUS: {
        "label": "Hazardous Waste",
        "color": "#e53935",
        "bin": "Hazardous Waste Facility",
        "icon": "hazard",
        "points": 20,
        "tip": "Chemically reactive, toxic or flammable waste needing special handling.",
    },
}

IGNORE_META = {
    "label": "Not Waste",
    "color": "#9e9e9e",
    "bin": "-",
    "icon": "info",
    "points": 0,
    "tip": "Not a waste item.",
}

VALID_CATEGORIES = set(CATEGORY_META) | {IGNORE}


def category_meta(category_key: str):
    """Return (category_key, meta_dict) for a category key, defaulting to
    IGNORE if the model returned something outside the known set."""
    if category_key not in CATEGORY_META:
        return IGNORE, IGNORE_META
    return category_key, CATEGORY_META[category_key]


def all_categories():
    return CATEGORY_META
