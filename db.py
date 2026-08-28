"""
db.py — tiny SQLite layer (no ORM needed) for detection history,
eco-points, streaks and badges.

Detections are scoped per signed-in user (user_id) — guests never get a
row written for them at all, so nothing about a guest's activity is
saved anywhere; every guest visit genuinely starts from zero. Only
Google-account holders accumulate persistent history/points.
"""
import sqlite3
import datetime
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance", "waste.db")


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            coco_label TEXT NOT NULL,
            category TEXT NOT NULL,
            confidence REAL NOT NULL,
            points INTEGER NOT NULL,
            source TEXT NOT NULL,
            user_id INTEGER
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_sub TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            picture TEXT,
            last_login TEXT NOT NULL
        )
        """
    )
    # Lightweight migration for a pre-existing local instance/waste.db that
    # predates the user_id column — safe to ignore if it's already there
    # (fresh deploys on Render never hit this since storage is ephemeral).
    try:
        conn.execute("ALTER TABLE detections ADD COLUMN user_id INTEGER")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()


def upsert_user(google_sub, email, name, picture):
    """Insert a user on first Google sign-in, or refresh their profile/last_login
    on every subsequent one. Returns their internal user id, which is what
    detections/points/history get scoped to."""
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO users (google_sub, email, name, picture, last_login)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(google_sub) DO UPDATE SET
            email=excluded.email, name=excluded.name, picture=excluded.picture, last_login=excluded.last_login
        """,
        (google_sub, email, name, picture, datetime.datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
    conn.close()
    return row["id"] if row else None


def log_detection(coco_label, category, confidence, points, source="webcam", user_id=None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO detections (ts, coco_label, category, confidence, points, source, user_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (datetime.datetime.now().isoformat(timespec="seconds"), coco_label, category,
         confidence, points, source, user_id),
    )
    conn.commit()
    conn.close()


def _empty_stats():
    return {
        "total_points": 0,
        "total_items": 0,
        "by_category": {},
        "streak": 0,
        "badge": "Rookie Sorter",
        "recent": [],
    }


def get_stats(user_id=None):
    """Stats for one signed-in user's own history. Guests (user_id=None)
    always get an empty result — nothing is tracked for them server-side."""
    if user_id is None:
        return _empty_stats()

    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM detections WHERE user_id = ? ORDER BY ts DESC", (user_id,)
    ).fetchall()
    conn.close()

    total_points = sum(r["points"] for r in rows)
    total_items = len(rows)

    by_category = {}
    for r in rows:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1

    # streak = number of consecutive days (including today) with >=1 detection
    dates = sorted({r["ts"][:10] for r in rows}, reverse=True)
    streak = 0
    if dates:
        today = datetime.date.today()
        expected = today
        for d in dates:
            d_date = datetime.date.fromisoformat(d)
            if d_date == expected:
                streak += 1
                expected = expected - datetime.timedelta(days=1)
            elif d_date == expected + datetime.timedelta(days=1):
                continue
            else:
                break

    # badge tiers
    if total_points >= 500:
        badge = "Platinum Segregator"
    elif total_points >= 250:
        badge = "Gold Segregator"
    elif total_points >= 100:
        badge = "Silver Segregator"
    elif total_points >= 25:
        badge = "Bronze Segregator"
    else:
        badge = "Rookie Sorter"

    recent = [dict(r) for r in rows[:25]]

    return {
        "total_points": total_points,
        "total_items": total_items,
        "by_category": by_category,
        "streak": streak,
        "badge": badge,
        "recent": recent,
    }


def clear_history(user_id=None):
    """Clears only the given user's own history. A guest (user_id=None) has
    nothing tracked server-side to clear, so this is a no-op for them —
    importantly, it never wipes other users' data (the old version deleted
    *everything*, regardless of who clicked Reset)."""
    if user_id is None:
        return
    conn = get_conn()
    conn.execute("DELETE FROM detections WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
