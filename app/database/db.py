import sqlite3
import os
from typing import Optional

DB_PATH = os.environ.get("PUMPGUARD_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "pumpguard.db"))

def connect(path: Optional[str] = None) -> sqlite3.Connection:
    p = path or DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    c = sqlite3.connect(p, timeout=15.0)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    return c

def init_db(path: Optional[str] = None):
    c = connect(path)
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            sim_t REAL NOT NULL,
            pump TEXT NOT NULL,
            scenario TEXT NOT NULL,
            suction_pressure REAL,
            discharge_pressure REAL,
            flow_rate REAL,
            vibration_rms REAL,
            temperature REAL,
            rpm REAL,
            predicted_class TEXT,
            risk_level INTEGER,
            model_score REAL,
            status TEXT NOT NULL,
            model_version TEXT,
            anomaly TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
        CREATE INDEX IF NOT EXISTS idx_readings_scenario ON readings(scenario);
        CREATE INDEX IF NOT EXISTS idx_readings_pump ON readings(pump);

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            pump TEXT NOT NULL,
            source TEXT NOT NULL,
            category TEXT NOT NULL,
            severity INTEGER NOT NULL,
            predicted_class TEXT,
            model_score REAL,
            readings TEXT NOT NULL,
            explanation TEXT NOT NULL,
            action TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            ack_ts TEXT,
            resolved_ts TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_alerts_pump_status ON alerts(pump, status);
        CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            pump TEXT NOT NULL,
            kind TEXT NOT NULL,
            detail TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_versions (
            version TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            model_type TEXT NOT NULL,
            accuracy REAL,
            f1_macro REAL,
            recall_cavitation REAL,
            is_active INTEGER NOT NULL DEFAULT 0,
            metrics_json TEXT NOT NULL
        );
        """)
        c.commit()
    finally:
        c.close()

def log_event(c: sqlite3.Connection, ts: str, pump: str, kind: str, detail: str = ""):
    c.execute("INSERT INTO events(ts, pump, kind, detail) VALUES(?,?,?,?)", (ts, pump, kind, detail))

def cleanup(c: sqlite3.Connection, max_readings: int = 20000, max_alerts: int = 2000):
    c.execute("""
        DELETE FROM readings WHERE id NOT IN (
            SELECT id FROM readings ORDER BY id DESC LIMIT ?
        )
    """, (max_readings,))
    c.execute("""
        DELETE FROM alerts WHERE id NOT IN (
            SELECT id FROM alerts ORDER BY id DESC LIMIT ?
        )
    """, (max_alerts,))
    c.commit()

