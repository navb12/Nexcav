"""
NexCav ML Inference Microservice (FastAPI)
Loads model.pkl and serves real-time cavitation probability predictions.
Exposes POST /predict and GET /health.
"""

import os
import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

app = FastAPI(title="NexCav ML Inference API", version="1.0.0")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "model.pkl")
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.pkl")

bundle = None
clf = None
feature_names = None
sensor_cols = None
window_size = 10

def load_model():
    global bundle, clf, feature_names, sensor_cols, window_size
    if os.path.exists(MODEL_PATH):
        try:
            bundle = joblib.load(MODEL_PATH)
            clf = bundle["model"]
            feature_names = bundle["feature_names"]
            sensor_cols = bundle["sensor_cols"]
            window_size = bundle.get("window_size", 10)
            print(f"[ML Server] Loaded model bundle from {MODEL_PATH}")
        except Exception as e:
            print(f"[ML Server] Failed to load model bundle: {e}")

load_model()

class TelemetryReading(BaseModel):
    suction_pressure: float
    discharge_pressure: float
    flow_rate: float
    vibration_rms: float
    temperature: float
    rpm: float
    time_s: Optional[float] = None

class PredictRequest(BaseModel):
    window: List[Dict[str, Any]]

@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": clf is not None,
        "model_type": "RandomForestClassifier" if clf else None,
        "window_size": window_size
    }

@app.post("/predict")
def predict(payload: PredictRequest):
    if clf is None:
        load_model()
        if clf is None:
            raise HTTPException(status_code=503, detail="Model bundle not loaded.")

    readings = payload.window
    if not readings:
        raise HTTPException(status_code=400, detail="Empty window of readings.")

    # Convert window to DataFrame
    df_window = pd.DataFrame(readings)

    # Ensure all sensor columns are present, fill missing with nominal
    NOMINALS = {
        "suction_pressure": 2.05,
        "discharge_pressure": 6.52,
        "flow_rate": 100.2,
        "vibration_rms": 1.85,
        "temperature": 52.5,
        "rpm": 2950.0
    }
    for col in sensor_cols:
        if col not in df_window.columns:
            df_window[col] = NOMINALS[col]
        else:
            df_window[col] = df_window[col].fillna(NOMINALS[col])

    # Extract rolling features across this window
    df_feat = pd.DataFrame(index=[0])
    recent_w = df_window.tail(window_size)
    latest = recent_w.iloc[-1]

    # 1. Instantaneous
    for col in sensor_cols:
        df_feat[col] = latest[col]

    # 2. Rolling stats over the window
    for col in sensor_cols:
        series = recent_w[col]
        df_feat[f"{col}_mean"] = series.mean()
        df_feat[f"{col}_std"] = series.std(ddof=1) if len(series) > 1 else 0.0
        df_feat[f"{col}_max"] = series.max()

    # 3. Domain physics ratios
    df_feat["head_diff"] = latest["discharge_pressure"] - latest["suction_pressure"]
    df_feat["vib_to_flow"] = (latest["vibration_rms"] / max(1.0, latest["flow_rate"])) * 100.0

    # Fill any NaNs
    df_feat = df_feat.fillna(0.0)

    # Reorder columns matching training
    X = df_feat[feature_names]

    # Inference with scikit-learn model
    probs = clf.predict_proba(X)[0]
    cav_prob = float(probs[1]) if len(probs) > 1 else float(probs[0])

    # Determine severity stage
    if cav_prob < 0.30:
        stage = "Normal"
    elif cav_prob < 0.60:
        stage = "Incipient"
    elif cav_prob < 0.85:
        stage = "Developed"
    else:
        stage = "Severe"

    predicted_class = int(clf.predict(X)[0])

    return {
        "probability": round(cav_prob, 4),
        "predicted_class": predicted_class,
        "severity_stage": stage,
        "model_type": "RandomForestClassifier",
        "model_version": "v3.0.0-python-rf"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5001, reload=False)
