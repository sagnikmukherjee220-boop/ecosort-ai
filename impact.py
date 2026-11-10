"""
impact.py — turns the site-wide detection tally into the Impact tracker's
numbers. The kg / CO2 figures are ILLUSTRATIVE ESTIMATES built from the
rough assumptions below (average item weight and an approximate emissions
benefit of handling that waste type properly instead of sending it to
landfill). They are shown to users as estimates, never as measured values.
Edit ASSUMPTIONS to change them; nothing else depends on the numbers.
"""
import datetime
import db
import waste_map

# category -> (avg kg per item, kg CO2e avoided per kg when handled correctly,
#              counted as "diverted from landfill")
ASSUMPTIONS = {
    waste_map.BIODEGRADABLE:   (0.25, 0.5, True),   # composted instead of landfilled (methane avoided)
    waste_map.RECYCLABLE:      (0.08, 1.5, True),   # mixed paper/plastic/metal/glass recycling
    waste_map.NON_RECYCLABLE:  (0.05, 0.0, False),  # correctly binned but still goes to disposal
    waste_map.E_WASTE:         (0.30, 2.0, True),   # recovered metals / safe handling
    waste_map.HAZARDOUS:       (0.10, 0.0, True),   # kept out of ordinary waste, no CO2 credit claimed
}


# Paper recycling: ~17 trees saved per tonne of paper recycled (commonly cited
# industry figure) and an average paper item of ~0.05 kg. Estimate only.
PAPER_KG_PER_ITEM = 0.05
TREES_PER_KG_PAPER = 0.017


def build(user_id=None):
    by_cat, per_day, mine, paper_items = db.get_impact_counts(user_id, days=7)
    total = sum(by_cat.values())
    kg = co2 = 0.0
    cats = []
    for key, meta in waste_map.CATEGORY_META.items():
        n = by_cat.get(key, 0)
        w, f, diverted = ASSUMPTIONS.get(key, (0, 0, False))
        if diverted:
            kg += n * w
        co2 += n * w * f
        cats.append({"key": key, "label": meta["label"], "color": meta["color"], "count": n})
    today = datetime.date.today()
    week = []
    for i in range(6, -1, -1):
        d = today - datetime.timedelta(days=i)
        week.append({"date": d.isoformat(), "day": d.strftime("%a"), "count": per_day.get(d.isoformat(), 0)})
    paper_kg = paper_items * PAPER_KG_PER_ITEM
    out = {"items": total, "kg_diverted": round(kg, 1), "co2_kg": round(co2, 1),
           "paper_kg": round(paper_kg, 1), "trees": round(paper_kg * TREES_PER_KG_PAPER, 2),
           "categories": cats, "week": week, "logged_in": user_id is not None}
    if user_id is not None:
        out["mine"] = mine or 0
        out["pct"] = round(100.0 * (mine or 0) / total, 1) if total else 0
    return out
