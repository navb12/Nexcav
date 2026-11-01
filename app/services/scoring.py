from typing import Dict, Any, List, Optional
import math

CLASSES = {
    0: "Normal Operation",
    1: "Possible Cavitation",
    2: "High Cavitation Risk"
}

FEATURE_NAMES = [
    "suction_pressure",
    "discharge_pressure",
    "flow_rate",
    "vibration_rms",
    "temperature",
    "rpm"
]

class ModelUnavailable(Exception):
    pass

def score(reading: Dict[str, Any], risk_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Given raw reading and risk config, produce model score, predicted class, risk level, and final status.
    If the trained ML model is available via registry, use it; otherwise, use calibrated proxy scoring.
    """
    for f in FEATURE_NAMES:
        if reading.get(f) is None:
            raise ValueError(f"Missing required sensor feature: {f}")

    from app.ml import registry
    bundle = registry.get()

    if bundle is not None and "model" in bundle:
        try:
            model = bundle["model"]
            features = [[float(reading[f]) for f in FEATURE_NAMES]]
            proba = model.predict_proba(features)[0]
            # Probabilities for classes: 0 = Normal, 1 = Developing, 2 = Severe
            # Model score is combined cavitation risk probability
            p_normal = float(proba[0]) if len(proba) > 0 else 0.0
            p_dev = float(proba[1]) if len(proba) > 1 else 0.0
            p_sev = float(proba[2]) if len(proba) > 2 else 0.0
            
            model_score = float(p_dev * 0.5 + p_sev * 1.0)
            pred_class_idx = int(model.predict(features)[0])
            pred_class = CLASSES.get(pred_class_idx, "Normal Operation")
            version = bundle.get("version", "v1.0.0")
        except Exception as e:
            raise ModelUnavailable(f"Inference error: {e}")
    else:
        # Fallback heuristic approximation based on physical thresholds
        # Suction drop + vibration rise + flow drop indicate cavitation
        suction = reading["suction_pressure"]
        vib = reading["vibration_rms"]
        flow = reading["flow_rate"]
        
        # Normal reference values: suction ~ 2.0, vib ~ 2.0, flow ~ 100.0
        suction_factor = max(0.0, min(1.0, (1.8 - suction) / 1.0))
        vib_factor = max(0.0, min(1.0, (vib - 2.5) / 4.0))
        flow_factor = max(0.0, min(1.0, (95.0 - flow) / 30.0))
        
        raw_score = 0.45 * suction_factor + 0.40 * vib_factor + 0.15 * flow_factor
        model_score = max(0.0, min(1.0, raw_score))
        
        if model_score >= risk_cfg.get("score_high", 0.70):
            pred_class_idx = 2
        elif model_score >= risk_cfg.get("score_low", 0.35):
            pred_class_idx = 1
        else:
            pred_class_idx = 0
            
        pred_class = CLASSES[pred_class_idx]
        version = "heuristic-baseline"

    # Risk level mapped according to score thresholds
    score_low = risk_cfg.get("score_low", 0.35)
    score_high = risk_cfg.get("score_high", 0.70)
    
    if model_score >= score_high:
        risk_level = 2
    elif model_score >= score_low:
        risk_level = 1
    else:
        risk_level = 0

    # Status = max(model class, level implied by score thresholds)
    final_level = max(pred_class_idx, risk_level)
    status = CLASSES[final_level]

    return {
        "model_score": round(model_score, 4),
        "predicted_class": pred_class,
        "predicted_class_idx": pred_class_idx,
        "risk_level": final_level,
        "status": status,
        "model_version": version
    }

def threshold_breaches(reading: Dict[str, Any], thresholds: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Check if any sensor reading violates configured alarm or warning thresholds."""
    breaches = []
    for sensor, limits in thresholds.items():
        val = reading.get(sensor)
        if val is None:
            continue
        val = float(val)
        op = limits.get("operator", ">")
        alarm = limits.get("alarm")
        warning = limits.get("warning")

        if op == ">":
            if alarm is not None and val >= alarm:
                breaches.append({"sensor": sensor, "level": "alarm", "value": val, "limit": alarm, "operator": op})
            elif warning is not None and val >= warning:
                breaches.append({"sensor": sensor, "level": "warning", "value": val, "limit": warning, "operator": op})
        elif op == "<":
            if alarm is not None and val <= alarm:
                breaches.append({"sensor": sensor, "level": "alarm", "value": val, "limit": alarm, "operator": op})
            elif warning is not None and val <= warning:
                breaches.append({"sensor": sensor, "level": "warning", "value": val, "limit": warning, "operator": op})
    return breaches

