"""
NexCav Offline Feedback Retraining Script (ml/retrain_with_feedback.py)

Manual CLI invocation only:
  python ml/retrain_with_feedback.py

Workflow:
1. Loads baseline training dataset from data/nexcav_train.csv (creates an in-memory copy).
2. Reads operator feedback reviews from data/feedback_log.csv:
   - verdict == 'correct'     -> label = 1 (Cavitation)
   - verdict == 'false_alarm' -> label = 0 (Normal)
3. Appends validated feedback samples to the training data copy.
4. Retrains a new Random Forest classifier.
5. Evaluates strictly on the UNCHANGED held-out test set data/test_runs.csv.
6. Saves models/model_v2.pkl and models/metrics_v2.json (NEVER overwrites production model.pkl).
7. Prints a side-by-side comparison of baseline vs candidate metrics.
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
    auc
)

SENSOR_COLS = [
    "suction_pressure",
    "discharge_pressure",
    "flow_rate",
    "vibration_rms",
    "temperature",
    "rpm"
]

WINDOW_SIZE = 10

def extract_run_features(df_run: pd.DataFrame, window: int = WINDOW_SIZE) -> pd.DataFrame:
    df_feat = pd.DataFrame(index=df_run.index)

    for col in SENSOR_COLS:
        df_feat[col] = df_run[col].values

    for col in SENSOR_COLS:
        rolling = df_run[col].rolling(window=window, min_periods=1)
        df_feat[f"{col}_mean"] = rolling.mean().values
        df_feat[f"{col}_std"] = rolling.std().fillna(0.0).values
        df_feat[f"{col}_max"] = rolling.max().values

    df_feat["head_diff"] = df_run["discharge_pressure"].values - df_run["suction_pressure"].values
    df_feat["vib_to_flow"] = (df_run["vibration_rms"].values / np.maximum(1.0, df_run["flow_rate"].values)) * 100.0

    return df_feat

def prepare_dataset(df: pd.DataFrame, window: int = WINDOW_SIZE):
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

def retrain_with_feedback():
    print("=" * 65)
    print("  NexCav Offline Model Retraining with Human Feedback (v2)")
    print("=" * 65)

    train_path = os.path.join("data", "nexcav_train.csv")
    test_path = os.path.join("data", "test_runs.csv")
    feedback_path = os.path.join("data", "feedback_log.csv")
    base_metrics_path = os.path.join("models", "metrics.json")

    if not os.path.exists(train_path) or not os.path.exists(test_path):
        raise FileNotFoundError("Base training or test dataset not found in data/.")

    # 1. Load in-memory copy of baseline training data (NEVER touch original CSV)
    df_train_base = pd.read_csv(train_path)
    df_train_copy = df_train_base.copy()
    df_test = pd.read_csv(test_path)

    # 2. Inspect feedback log
    feedback_rows = []
    if os.path.exists(feedback_path):
        df_fb = pd.read_csv(feedback_path)
        valid_fb = df_fb[df_fb["verdict"].isin(["correct", "false_alarm"])].copy()
        print(f"\n[Feedback Data] Found {len(df_fb)} total alert logs; {len(valid_fb)} reviewed with human verdict.")

        for idx, row in valid_fb.iterrows():
            lbl = 1 if row["verdict"] == "correct" else 0
            feedback_rows.append({
                "run_id": f"feedback_run_{idx // 10}",
                "time_s": idx % 60,
                "suction_pressure": float(row.get("suction_pressure", 2.0)),
                "discharge_pressure": float(row.get("discharge_pressure", 6.5)),
                "flow_rate": float(row.get("flow_rate", 100.0)),
                "vibration_rms": float(row.get("vibration_rms", 1.85)),
                "temperature": float(row.get("temperature", 52.0)),
                "rpm": 2950.0,
                "severity_pct": 35.0 if lbl == 1 else 0.0,
                "label": lbl
            })
    else:
        print("\n[Feedback Data] No data/feedback_log.csv found yet. Retraining with baseline data copy.")

    if len(feedback_rows) > 0:
        df_feedback = pd.DataFrame(feedback_rows)
        df_train_augmented = pd.concat([df_train_copy, df_feedback], ignore_index=True)
        print(f"Added {len(feedback_rows)} operator-validated samples to training dataset copy.")
    else:
        df_train_augmented = df_train_copy
        print("Note: 0 reviewed feedback samples available. Retraining on pure baseline training copy.")

    # 3. Extract features & train candidate model
    print("\nExtracting rolling features (window=10s)...")
    X_train, y_train, train_runs = prepare_dataset(df_train_augmented, window=WINDOW_SIZE)
    X_test, y_test, test_runs = prepare_dataset(df_test, window=WINDOW_SIZE)
    feature_names = list(X_train.columns)

    clf_v2 = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_leaf=3,
        random_state=42,
        class_weight="balanced",
        n_jobs=1
    )
    clf_v2.fit(X_train, y_train)

    # 4. Evaluate strictly on held-out test data
    y_pred = clf_v2.predict(X_test)
    y_probs = clf_v2.predict_proba(X_test)[:, 1]

    acc = float(accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred, zero_division=0))
    rec = float(recall_score(y_test, y_pred, zero_division=0))
    f1 = float(f1_score(y_test, y_pred, zero_division=0))
    cm = confusion_matrix(y_test, y_pred).tolist()

    fpr, tpr, thresholds = roc_curve(y_test, y_probs)
    roc_auc = float(auc(fpr, tpr))

    step = max(1, len(fpr) // 30)
    roc_points = [
        {"fpr": round(float(fpr[i]), 4), "tpr": round(float(tpr[i]), 4)}
        for i in range(0, len(fpr), step)
    ]
    if {"fpr": round(float(fpr[-1]), 4), "tpr": round(float(tpr[-1]), 4)} not in roc_points:
        roc_points.append({"fpr": round(float(fpr[-1]), 4), "tpr": round(float(tpr[-1]), 4)})

    importances = [
        {"feature": name, "importance": round(float(imp), 4)}
        for name, imp in sorted(zip(feature_names, clf_v2.feature_importances_), key=lambda x: x[1], reverse=True)
    ]

    metrics_v2 = {
        "model_version": "model_v2",
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
            "test_samples": int(len(X_test)),
            "feedback_samples_added": len(feedback_rows)
        },
        "class_balance": {
            "train": {int(k): int(v) for k, v in pd.Series(y_train).value_counts().items()},
            "test": {int(k): int(v) for k, v in pd.Series(y_test).value_counts().items()}
        },
        "classes": ["Normal Operation", "Cavitation"]
    }

    # 5. Save candidate model_v2.pkl and metrics_v2.json (NEVER overwrite production model.pkl)
    os.makedirs("models", exist_ok=True)
    model_v2_bundle = {
        "model": clf_v2,
        "feature_names": feature_names,
        "sensor_cols": SENSOR_COLS,
        "window_size": WINDOW_SIZE,
        "classes": ["Normal Operation", "Cavitation"]
    }

    v2_model_path = os.path.join("models", "model_v2.pkl")
    v2_metrics_path = os.path.join("models", "metrics_v2.json")
    joblib.dump(model_v2_bundle, v2_model_path)
    with open(v2_metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_v2, f, indent=2)

    print(f"\n[Saved] Candidate model bundle -> {v2_model_path}")
    print(f"[Saved] Candidate metrics      -> {v2_metrics_path}")
    print("[Guarantee] Production model (models/model.pkl) was NOT overwritten.")

    # 6. Load baseline metrics for side-by-side comparison
    base_metrics = {}
    if os.path.exists(base_metrics_path):
        with open(base_metrics_path, "r", encoding="utf-8") as f:
            base_metrics = json.load(f)

    print("\n" + "=" * 65)
    print("  SIDE-BY-SIDE EVALUATION ON HELD-OUT TEST DATA")
    print("=" * 65)
    header = f"{'Metric':<22} | {'Baseline (model.pkl)':<20} | {'Candidate (model_v2.pkl)':<20}"
    print(header)
    print("-" * len(header))

    b_acc = base_metrics.get("accuracy", 0.0) * 100
    n_acc = acc * 100
    b_prec = base_metrics.get("precision", 0.0) * 100
    n_prec = prec * 100
    b_rec = base_metrics.get("recall", 0.0) * 100
    n_rec = rec * 100
    b_f1 = base_metrics.get("f1_score", 0.0) * 100
    n_f1 = f1 * 100
    b_auc = base_metrics.get("roc_auc", 0.0)
    n_auc = roc_auc

    print(f"{'Overall Accuracy':<22} | {b_acc:>18.2f}% | {n_acc:>18.2f}%")
    print(f"{'Precision':<22} | {b_prec:>18.2f}% | {n_prec:>18.2f}%")
    print(f"{'Recall':<22} | {b_rec:>18.2f}% | {n_rec:>18.2f}%")
    print(f"{'F1-Score':<22} | {b_f1:>18.2f}% | {n_f1:>18.2f}%")
    print(f"{'ROC-AUC':<22} | {b_auc:>19.4f} | {n_auc:>19.4f}")
    print(f"{'Training Samples':<22} | {4800:>19} | {len(X_train):>19}")
    print(f"{'Feedback Rows Added':<22} | {'0':>19} | {len(feedback_rows):>19}")
    print("=" * 65)

    print("\n[Statistical Governance Notice]")
    print(f"- Current feedback rows incorporated: {len(feedback_rows)}")
    if len(feedback_rows) < 50:
        print("  WARNING: Fewer than 50 feedback rows are currently available.")
        print("  Clicking 2-5 times produces too few samples relative to the 4,800 baseline")
        print("  rows to shift the statistical decision boundaries meaningfully.")
        print("  In an industrial setting, at least 50 to 100 diverse, independently reviewed")
        print("  operational episodes across various pump operating conditions are required")
        print("  before retraining yields a statistically significant and unbiased model improvement.")
    else:
        print("  Sufficient feedback volume reached for candidate model review.")

if __name__ == "__main__":
    retrain_with_feedback()

