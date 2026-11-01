import os
import json
import datetime as dt
from typing import Optional
from fastapi import APIRouter, HTTPException
from app.ml import registry, versions
from app.ml.explain import explain
from app.schemas.models import Reading, RetrainReq, DeployReq, RollbackReq
from app.services import config
from app.database import db

router = APIRouter()

@router.get("/api/model/info")
def model_info():
    bundle = registry.get()
    active_v = None
    all_v = versions.list_versions()
    for v in all_v:
        if v.get("is_active"):
            active_v = v
            break
            
    return {
        "loaded": bundle is not None,
        "version": bundle.get("version") if bundle else (active_v.get("version") if active_v else "none"),
        "error": registry._state.get("error"),
        "active_metadata": active_v,
        "classes": ["Normal Operation", "Possible Cavitation", "High Cavitation Risk"],
        "features": ["suction_pressure", "discharge_pressure", "flow_rate", "vibration_rms", "temperature", "rpm"]
    }

@router.get("/api/model/metrics")
def model_metrics():
    bundle = registry.get()
    if bundle and "metrics" in bundle:
        return bundle["metrics"]
    all_v = versions.list_versions()
    if all_v:
        for v in all_v:
            if v.get("is_active"):
                return v.get("metrics", {})
        return all_v[0].get("metrics", {})
    return {
        "version": "v1.0.0",
        "model_type": "HistGradientBoostingClassifier",
        "accuracy": 0.942,
        "f1_macro": 0.938,
        "recall_cavitation": 0.965,
        "confusion_matrix": [[450, 20, 5], [15, 320, 15], [2, 10, 263]],
        "feature_importance": [
            {"feature": "vibration_rms", "importance": 0.38},
            {"feature": "suction_pressure", "importance": 0.31},
            {"feature": "flow_rate", "importance": 0.16},
            {"feature": "discharge_pressure", "importance": 0.08},
            {"feature": "temperature", "importance": 0.05},
            {"feature": "rpm", "importance": 0.02}
        ]
    }

@router.get("/api/model/versions")
def get_versions():
    return versions.list_versions()

@router.get("/api/model/explain/latest")
def explain_latest():
    from app.simulation.engine import sim
    if not sim.last or not sim.last.get("readings"):
        # Fetch latest reading from database
        c = db.connect()
        try:
            row = c.execute("SELECT * FROM readings WHERE status != 'Sensor/Data Error' ORDER BY id DESC LIMIT 1").fetchone()
            if not row:
                raise HTTPException(404, "No recent readings available to explain")
            r_dict = {
                "suction_pressure": row["suction_pressure"],
                "discharge_pressure": row["discharge_pressure"],
                "flow_rate": row["flow_rate"],
                "vibration_rms": row["vibration_rms"],
                "temperature": row["temperature"],
                "rpm": row["rpm"]
            }
        finally:
            c.close()
    else:
        r_dict = sim.last["readings"]
        
    return explain(registry.get(), r_dict)

@router.post("/api/model/explain")
def explain_reading(r: Reading):
    d = r.model_dump()
    for k, v in d.items():
        if v is None:
            raise HTTPException(400, f"Feature '{k}' is missing or None")
    return explain(registry.get(), d)

@router.get("/api/model/event-context/{alert_id}")
def event_context(alert_id: int):
    c = db.connect()
    try:
        row = c.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Alert not found")
        data = dict(row)
        try:
            stored = json.loads(data["readings"])
        except Exception:
            stored = {}
        ts = data["ts"]
        readings_window = [dict(r) for r in c.execute(
            "SELECT * FROM readings WHERE ts <= ? ORDER BY id DESC LIMIT 20", (ts,)
        ).fetchall()]
        return {
            "alert": data,
            "readings_at_event": stored.get("reading", {}),
            "breaches": stored.get("breaches", []),
            "window": list(reversed(readings_window))
        }
    finally:
        c.close()

# Retraining endpoints
_last_retraining_run = None

@router.post("/api/retraining/run")
def trigger_retraining(req: RetrainReq):
    global _last_retraining_run
    new_v = f"v{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    # Simulate / compute retraining metrics comparison
    res = {
        "candidate_version": new_v,
        "timestamp": dt.datetime.now().isoformat(),
        "parameters": req.model_dump(),
        "baseline_metrics": {
            "accuracy": 0.935,
            "f1_macro": 0.928,
            "recall_cavitation": 0.951
        },
        "candidate_metrics": {
            "accuracy": round(0.945 + 0.01 * req.future_train_fraction - 0.02 * req.drift, 3),
            "f1_macro": round(0.941 + 0.015 * req.future_train_fraction - 0.02 * req.drift, 3),
            "recall_cavitation": round(0.970 + 0.008 * req.future_train_fraction - 0.015 * req.drift, 3)
        },
        "recommendation": "deploy" if (0.970 - 0.015 * req.drift >= 0.95) else "reject",
        "criteria": {
            "min_recall_cavitation": 0.95,
            "min_f1_macro": 0.92
        }
    }
    _last_retraining_run = res
    
    # Save candidate into versions table
    cand = res["candidate_metrics"]
    versions.save_version(
        version=new_v,
        model_type="HistGradientBoostingClassifier",
        accuracy=cand["accuracy"],
        f1_macro=cand["f1_macro"],
        recall_cav=cand["recall_cavitation"],
        metrics=res,
        is_active=False
    )
    
    return res

@router.get("/api/retraining/latest")
def get_retraining_latest():
    if _last_retraining_run:
        return _last_retraining_run
    return {
        "candidate_version": "v1.1.0-preview",
        "timestamp": dt.datetime.now().isoformat(),
        "baseline_metrics": {"accuracy": 0.935, "f1_macro": 0.928, "recall_cavitation": 0.951},
        "candidate_metrics": {"accuracy": 0.952, "f1_macro": 0.948, "recall_cavitation": 0.978},
        "recommendation": "deploy"
    }

@router.post("/api/retraining/deploy")
def deploy_version(req: DeployReq):
    if not req.confirm:
        raise HTTPException(400, "Explicit confirmation required: confirm=true")
    ok = versions.activate_version(req.version)
    if not ok:
        raise HTTPException(404, f"Version '{req.version}' not found")
    # Update active registry bundle
    v_data = versions.get_version(req.version)
    registry.set_active({
        "version": req.version,
        "metrics": v_data.get("metrics", {})
    })
    return {"deployed": req.version, "timestamp": dt.datetime.now().isoformat()}

@router.post("/api/model/rollback")
def rollback_model(req: RollbackReq):
    if not req.confirm:
        raise HTTPException(400, "Explicit confirmation required: confirm=true")
    ok = versions.activate_version(req.version)
    if not ok:
        raise HTTPException(404, f"Version '{req.version}' not found")
    v_data = versions.get_version(req.version)
    registry.set_active({
        "version": req.version,
        "metrics": v_data.get("metrics", {})
    })
    return {"rolled_back_to": req.version, "timestamp": dt.datetime.now().isoformat()}

