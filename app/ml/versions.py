import os
import json
import datetime as dt
from typing import List, Dict, Any, Optional
from app.database import db

def list_versions() -> List[Dict[str, Any]]:
    c = db.connect()
    try:
        rows = c.execute("SELECT * FROM model_versions ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["metrics"] = json.loads(d.get("metrics_json", "{}"))
            except Exception:
                d["metrics"] = {}
            result.append(d)
        return result
    finally:
        c.close()

def get_version(version: str) -> Optional[Dict[str, Any]]:
    c = db.connect()
    try:
        row = c.execute("SELECT * FROM model_versions WHERE version = ?", (version,)).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["metrics"] = json.loads(d.get("metrics_json", "{}"))
        except Exception:
            d["metrics"] = {}
        return d
    finally:
        c.close()

def save_version(version: str, model_type: str, accuracy: float, f1_macro: float, recall_cav: float, metrics: dict, is_active: bool = False):
    c = db.connect()
    try:
        now = dt.datetime.now().isoformat()
        if is_active:
            c.execute("UPDATE model_versions SET is_active = 0")
        c.execute("""
            INSERT OR REPLACE INTO model_versions (version, created_at, model_type, accuracy, f1_macro, recall_cavitation, is_active, metrics_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (version, now, model_type, accuracy, f1_macro, recall_cav, 1 if is_active else 0, json.dumps(metrics)))
        c.commit()
    finally:
        c.close()

def activate_version(version: str) -> bool:
    c = db.connect()
    try:
        row = c.execute("SELECT * FROM model_versions WHERE version = ?", (version,)).fetchone()
        if not row:
            return False
        c.execute("UPDATE model_versions SET is_active = 0")
        c.execute("UPDATE model_versions SET is_active = 1 WHERE version = ?", (version,))
        c.commit()
        return True
    finally:
        c.close()

