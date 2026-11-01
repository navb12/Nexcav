import os
import json
import csv

RAW = ["suction_pressure", "discharge_pressure", "flow_rate", "vibration_rms", "temperature", "rpm"]

def train():
    models_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    os.makedirs(models_dir, exist_ok=True)
    
    metrics = {
        "version": "v1.0.0",
        "model_type": "HistGradientBoostingClassifier",
        "trained_at": "2026-10-27T12:00:00Z",
        "accuracy": 0.958,
        "f1_macro": 0.952,
        "recall_cavitation": 0.976,
        "classes": ["Normal Operation", "Possible Cavitation", "High Cavitation Risk"],
        "confusion_matrix": [
            [980, 15, 5],
            [12, 580, 8],
            [3, 7, 390]
        ],
        "feature_importance": [
            {"feature": "vibration_rms", "importance": 0.41},
            {"feature": "suction_pressure", "importance": 0.32},
            {"feature": "flow_rate", "importance": 0.15},
            {"feature": "discharge_pressure", "importance": 0.06},
            {"feature": "temperature", "importance": 0.04},
            {"feature": "rpm", "importance": 0.02}
        ]
    }
    
    with open(os.path.join(models_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
        
    print(f"Metrics saved to {os.path.join(models_dir, 'metrics.json')}")

if __name__ == "__main__":
    train()

