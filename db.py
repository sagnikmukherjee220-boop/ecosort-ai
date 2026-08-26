"""
db.py — tiny SQLite layer (no ORM needed) for detection history,
eco-points, streaks and badges. Zero external services, fully local,
so it works offline and is 100% under the student's control.
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
            source TEXT NOT NULL
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
    conn.commit()
    conn.close()


def upsert_user(google_sub, email, name, picture):
    """Insert a user on first Google sign-in, or refresh their profile/last_login
    on every subsequent one. Eco-points/history stay shared/global (unchanged) —
    this table exists only to remember who's signed in, for the navbar greeting."""
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
    conn.close()


def log_detection(coco_label, category, confidence, points, source="webcam"):
    conn = get_conn()
    conn.execute(
        "INSERT INTO detections (ts, coco_label, category, confidence, points, source) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (datetime.datetime.now().isoformat(timespec="seconds"), coco_label, category,
         confidence, points, source),
    )
    conn.commit()
    conn.close()


def get_stats():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM detections ORDER BY ts DESC").fetchall()
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


def clear_history():
    conn = get_conn()
    conn.execute("DELETE FROM detections")
    conn.commit()
    conn.close()
