"""
waste_map.py
--------------------------------------------------------------------
The 'brain' that turns a raw object-detection label (from the YOLOv8
COCO-pretrained model) into a waste-segregation decision.

Why this design (worth explaining to your examiner):
  Training a custom object-detection model from scratch on a small
  student-collected waste dataset is slow and, on exam day, often
  unreliable (bad lighting, unseen backgrounds, tiny dataset).
  Instead this project uses a robust, industry-standard, pretrained
  YOLOv8 detector (trained on 80 everyday object classes / COCO) for
  the *detection* stage, and then applies a rule-based *classification*
  / knowledge-engine stage on top that maps each recognised object to
  a waste-segregation category with disposal guidance. This is the
  same "detect -> reason" pattern used in real recycling-robot systems
  (e.g. AMP Robotics), and it is far more demo-reliable while still
  genuinely demonstrating multi-object detection + classification.
--------------------------------------------------------------------
"""

# Waste category identifiers used across the whole app
BIODEGRADABLE = "biodegradable"
RECYCLABLE = "recyclable"
NON_RECYCLABLE = "non_recyclable"
E_WASTE = "e_waste"
HAZARDOUS = "hazardous"
IGNORE = "ignore"  # detected object is not a waste item (e.g. a person, a dog)

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

# Map each COCO class (that YOLOv8n can detect) to a waste category.
# Objects irrelevant to waste segregation (people, animals, vehicles, etc.)
# are mapped to IGNORE so the UI can grey them out instead of mis-labelling them.
COCO_TO_WASTE = {
    # ---- Biodegradable / organic ----
    "banana": BIODEGRADABLE,
    "apple": BIODEGRADABLE,
    "sandwich": BIODEGRADABLE,
    "orange": BIODEGRADABLE,
    "broccoli": BIODEGRADABLE,
    "carrot": BIODEGRADABLE,
    "hot dog": BIODEGRADABLE,
    "pizza": BIODEGRADABLE,
    "donut": BIODEGRADABLE,
    "cake": BIODEGRADABLE,

    # ---- Recyclable dry waste (paper / plastic / glass / metal) ----
    "bottle": RECYCLABLE,
    "wine glass": RECYCLABLE,
    "cup": RECYCLABLE,
    "book": RECYCLABLE,
    "vase": RECYCLABLE,
    "bowl": RECYCLABLE,
    "scissors": RECYCLABLE,
    "sports ball": RECYCLABLE,
    "frisbee": RECYCLABLE,

    # ---- Non-recyclable / mixed-material reject waste ----
    "fork": NON_RECYCLABLE,
    "knife": NON_RECYCLABLE,
    "spoon": NON_RECYCLABLE,
    "teddy bear": NON_RECYCLABLE,
    "toothbrush": NON_RECYCLABLE,
    "handbag": NON_RECYCLABLE,
    "backpack": NON_RECYCLABLE,
    "umbrella": NON_RECYCLABLE,
    "tie": NON_RECYCLABLE,
    "suitcase": NON_RECYCLABLE,

    # ---- E-waste ----
    "tv": E_WASTE,
    "laptop": E_WASTE,
    "mouse": E_WASTE,
    "remote": E_WASTE,
    "keyboard": E_WASTE,
    "cell phone": E_WASTE,
    "microwave": E_WASTE,
    "oven": E_WASTE,
    "toaster": E_WASTE,
    "hair drier": E_WASTE,
    "clock": E_WASTE,
    "refrigerator": E_WASTE,

    # everything else (person, car, animals, furniture, etc.) -> ignore
}

IGNORED_HINT = (
    "Not a waste item. This project focuses on segregating discarded "
    "objects, so people, animals, vehicles and furniture are ignored."
)


def classify(coco_label: str):
    """Return (category_key, meta_dict) for a raw COCO class name."""
    category = COCO_TO_WASTE.get(coco_label, IGNORE)
    if category == IGNORE:
        return IGNORE, {
            "label": "Not Waste",
            "color": "#9e9e9e",
            "bin": "-",
            "icon": "info",
            "points": 0,
            "tip": IGNORED_HINT,
        }
    return category, CATEGORY_META[category]


def all_categories():
    return CATEGORY_META
