import os
import json
import logging
from typing import Optional, Dict, Any

log = logging.getLogger("pumpguard.registry")

_state: Dict[str, Any] = {
    "bundle": None,
    "version": None,
    "error": None
}

MODELS_DIR = os.environ.get("PUMPGUARD_MODELS_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models"))

def load_active():
    global _state
    try:
        model_path = os.path.join(MODELS_DIR, "model.joblib")
        metrics_path = os.path.join(MODELS_DIR, "metrics.json")
        
        if os.path.exists(model_path):
            import joblib
            model = joblib.load(model_path)
            metrics = {}
            if os.path.exists(metrics_path):
                with open(metrics_path, "r") as f:
                    metrics = json.load(f)
            
            version = metrics.get("version", "v1.0.0")
            _state["bundle"] = {
                "model": model,
                "version": version,
                "metrics": metrics
            }
            _state["version"] = version
            _state["error"] = None
            log.info(f"Loaded active model version {version}")
        else:
            # Model file not yet generated or trained
            _state["bundle"] = None
            _state["version"] = None
            _state["error"] = "Model weights file not found on disk"
    except Exception as e:
        _state["bundle"] = None
        _state["version"] = None
        _state["error"] = str(e)
        log.warning(f"Could not load ML model: {e}")

def get() -> Optional[Dict[str, Any]]:
    if _state["bundle"] is None and _state["error"] is None:
        load_active()
    return _state["bundle"]

def set_active(bundle: Dict[str, Any]):
    global _state
    _state["bundle"] = bundle
    _state["version"] = bundle.get("version", "custom")
    _state["error"] = None

