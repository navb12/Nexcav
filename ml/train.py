"""
NexCav Model Training Script
Trains a Random Forest classifier using scikit-learn on data/nexcav_train.csv.
Evaluates on held-out data/test_runs.csv.
Saves model.pkl and models/metrics.json.
Features are calculated over rolling windows strictly WITHIN each run.
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    roc_curve,
    auc,
    classification_report
)

SENSOR_COLS = [
    "suction_pressure",
    "discharge_pressure",
    "flow_rate",
    "vibration_rms",
    "temperature",
    "rpm"
]

WINDOW_SIZE = 10  # 10-second rolling window

def extract_run_features(df_run: pd.DataFrame, window: int = WINDOW_SIZE) -> pd.DataFrame:
    """
    Extract rolling features within a single run.
    Never spills across run boundaries.
    """
    df_feat = pd.DataFrame(index=df_run.index)

    # 1. Instantaneous sensor readings
    for col in SENSOR_COLS:
        df_feat[col] = df_run[col].values

    # 2. Rolling statistics within this run (min_periods=1 so no rows are dropped)
    for col in SENSOR_COLS:
        rolling = df_run[col].rolling(window=window, min_periods=1)
        df_feat[f"{col}_mean"] = rolling.mean().values
        df_feat[f"{col}_std"] = rolling.std().fillna(0.0).values
        df_feat[f"{col}_max"] = rolling.max().values

    # 3. Domain physics ratios
    df_feat["head_diff"] = df_run["discharge_pressure"].values - df_run["suction_pressure"].values
    df_feat["vib_to_flow"] = (df_run["vibration_rms"].values / np.maximum(1.0, df_run["flow_rate"].values)) * 100.0

    return df_feat

def prepare_dataset(df: pd.DataFrame, window: int = WINDOW_SIZE):
    """
    Groups dataframe by run_id, extracts features per run, and concats.
    """
    feature_dfs = []
    y_list = []
    runs_count = df["run_id"].nunique()

    for rid, group in df.groupby("run_id", sort=False):
        group_feat = extract_run_features(group, window=window)
        feature_dfs.append(group_feat)
        y_list.append(group["label"].values)

    X = pd.concat(feature_dfs, axis=0).reset_index(drop=True)
    y = np.concatenate(y_list)
    return X, y, runs_count

def train_and_evaluate():
    train_path = os.path.join("data", "nexcav_train.csv")
    test_path = os.path.join("data", "test_runs.csv")

    if not os.path.exists(train_path) or not os.path.exists(test_path):
        raise FileNotFoundError("Training or test dataset not found in data/. Run data/generate_dataset.py first.")

    df_train = pd.read_csv(train_path)
    df_test = pd.read_csv(test_path)

    print(f"Loaded train data: {len(df_train)} rows across {df_train['run_id'].nunique()} runs")
    print(f"Loaded test data:  {len(df_test)} rows across {df_test['run_id'].nunique()} runs")

    X_train, y_train, train_runs = prepare_dataset(df_train, window=WINDOW_SIZE)
    X_test, y_test, test_runs = prepare_dataset(df_test, window=WINDOW_SIZE)

    feature_names = list(X_train.columns)
    print(f"Extracted {len(feature_names)} features per sample.")

    # Train Random Forest Classifier
    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_leaf=3,
        random_state=42,
        class_weight="balanced",
        n_jobs=1
    )
    clf.fit(X_train, y_train)

    # Evaluate on held-out test runs
    y_pred = clf.predict(X_test)
    y_probs = clf.predict_proba(X_test)[:, 1]

    acc = float(accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    rec = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    cm = confusion_matrix(y_test, y_pred).tolist()

    fpr, tpr, thresholds = roc_curve(y_test, y_probs)
    roc_auc = float(auc(fpr, tpr))

    # Downsample ROC points for concise JSON storage (~30 points)
    step = max(1, len(fpr) // 30)
    roc_points = [
        {"fpr": round(float(fpr[i]), 4), "tpr": round(float(tpr[i]), 4)}
        for i in range(0, len(fpr), step)
    ]
    if {"fpr": round(float(fpr[-1]), 4), "tpr": round(float(tpr[-1]), 4)} not in roc_points:
        roc_points.append({"fpr": round(float(fpr[-1]), 4), "tpr": round(float(tpr[-1]), 4)})

    # Feature importances
    importances = [
        {"feature": name, "importance": round(float(imp), 4)}
        for name, imp in sorted(zip(feature_names, clf.feature_importances_), key=lambda x: x[1], reverse=True)
    ]

    metrics = {
        "model_type": "RandomForestClassifier",
        "accuracy": round(acc, 4),
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1_score": round(f1, 4),
        "roc_auc": round(roc_auc, 4),
        "confusion_matrix": cm,
        "roc_curve": roc_points,
        "feature_importances": importances[:15],
        "split_sizes": {
            "train_runs": int(train_runs),
            "test_runs": int(test_runs),
            "train_samples": int(len(X_train)),
            "test_samples": int(len(X_test))
        },
        "class_balance": {
            "train": {int(k): int(v) for k, v in pd.Series(y_train).value_counts().items()},
            "test": {int(k): int(v) for k, v in pd.Series(y_test).value_counts().items()}
        },
        "classes": ["Normal Operation", "Cavitation"],
        "window_size_seconds": WINDOW_SIZE
    }

    print("\n=== Real Held-Out Test Evaluation ===")
    print(f"Accuracy:  {acc * 100:.2f}% (Target: 93 - 97%)")
    print(f"Precision: {prec * 100:.2f}%")
    print(f"Recall:    {rec * 100:.2f}%")
    print(f"F1-Score:  {f1 * 100:.2f}%")
    print(f"ROC-AUC:   {roc_auc:.4f}")
    print(f"Confusion Matrix: {cm}")

    # Save model artifacts
    os.makedirs("models", exist_ok=True)
    os.makedirs("ml", exist_ok=True)

    model_bundle = {
        "model": clf,
        "feature_names": feature_names,
        "sensor_cols": SENSOR_COLS,
        "window_size": WINDOW_SIZE,
        "classes": ["Normal Operation", "Cavitation"]
    }

    joblib.dump(model_bundle, os.path.join("models", "model.pkl"))
    joblib.dump(model_bundle, os.path.join("ml", "model.pkl"))
    print("Saved model bundle to models/model.pkl and ml/model.pkl")

    metrics_path = os.path.join("models", "metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved real metrics to {metrics_path}")

    return metrics

if __name__ == "__main__":
    train_and_evaluate()
