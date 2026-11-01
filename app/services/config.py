import json
import datetime as dt
from app.database import db
from app.schemas.models import Settings

_current_settings = None

def get() -> dict:
    global _current_settings
    if _current_settings is not None:
        return _current_settings
    
    c = db.connect()
    try:
        row = c.execute("SELECT data FROM settings WHERE id = 1").fetchone()
        if row:
            _current_settings = json.loads(row["data"])
            return _current_settings
        else:
            default_settings = Settings().model_dump()
            now = dt.datetime.now().isoformat()
            c.execute("INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (1, ?, ?)",
                      (json.dumps(default_settings), now))
            c.commit()
            _current_settings = default_settings
            return _current_settings
    finally:
        c.close()

def update(settings_obj: Settings) -> dict:
    global _current_settings
    data = settings_obj.model_dump()
    now = dt.datetime.now().isoformat()
    c = db.connect()
    try:
        c.execute("INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (1, ?, ?)",
                  (json.dumps(data), now))
        c.commit()
        _current_settings = data
        return _current_settings
    finally:
        c.close()

