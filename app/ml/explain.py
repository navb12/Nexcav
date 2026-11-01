import math
from typing import Dict, Any, List

FEATURE_UNITS = {
    "suction_pressure": "bar",
    "discharge_pressure": "bar",
    "flow_rate": "m³/h",
    "vibration_rms": "mm/s",
    "temperature": "°C",
    "rpm": "RPM"
}

NORMAL_BASELINES = {
    "suction_pressure": {"mean": 2.0, "std": 0.15},
    "discharge_pressure": {"mean": 6.5, "std": 0.20},
    "flow_rate": {"mean": 100.0, "std": 5.0},
    "vibration_rms": {"mean": 2.0, "std": 0.40},
    "temperature": {"mean": 55.0, "std": 1.5},
    "rpm": {"mean": 2950.0, "std": 12.0}
}

def explain(model_bundle: Any, reading: Dict[str, Any]) -> Dict[str, Any]:
    """
    Local explanation by baseline substitution and normal distribution z-scores.
    Evaluates how replacing each feature with its nominal baseline alters the cavitation score.
    """
    features = list(FEATURE_UNITS.keys())
    
    # Calculate baseline substitution score delta
    from app.services.scoring import score
    default_risk = {"score_low": 0.35, "score_high": 0.70}
    
    # Original score
    base_res = score(reading, default_risk)
    orig_score = base_res["model_score"]
    
    attributions = []
    for f in features:
        val = reading.get(f)
        if val is None:
            continue
        
        # Z-score relative to normal baseline
        norm = NORMAL_BASELINES.get(f, {"mean": val, "std": 1.0})
        z_score = (float(val) - norm["mean"]) / max(1e-5, norm["std"])
        
        # Baseline substitution: substitute baseline mean for this feature
        substituted = dict(reading)
        substituted[f] = norm["mean"]
        
        try:
            sub_res = score(substituted, default_risk)
            # score_change: positive means this feature was pushing the cavitation score UP
            score_change = orig_score - sub_res["model_score"]
        except Exception:
            score_change = 0.0
        
        attributions.append({
            "feature": f,
            "value": round(float(val), 2),
            "unit": FEATURE_UNITS.get(f, ""),
            "score_change": round(score_change, 3),
            "z_score": round(z_score, 2),
            "baseline_mean": norm["mean"]
        })
        
    # Sort attributions by descending magnitude of influence
    attributions.sort(key=lambda x: abs(x["score_change"]), reverse=True)
    
    return {
        "original_score": orig_score,
        "attributions": attributions,
        "method": "baseline_substitution_and_zscore"
    }

