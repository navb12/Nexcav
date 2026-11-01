# PumpGuard AI (backend + ML pipeline)
All data is SYNTHETIC/SIMULATED. Model scores are uncalibrated and not real-world probabilities.

## Windows CMD
```
cd pumpguard-ai\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m training.generate_dataset
python -m training.train_model
python -m training.evaluate_model
python -m training.retraining_experiment
python -m pytest -q tests
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

## ML pipeline
- `training/generate_dataset.py` - synthetic data, 3 classes, overlapping distributions, optional drift after month 6 and label noise.
- `training/train_model.py` - Random Forest vs HistGradientBoosting, stratified split, selected by cavitation recall (F1 tie-break); saves `models/model.joblib` + `models/metrics.json`.
- `training/evaluate_model.py` - accuracy, per-class P/R/F1, confusion matrices, ROC-AUC, FNR/FPR; CLI scores the saved model on a fresh held-out set.
- `app/ml/explain.py` - local explanation by baseline substitution (NOT SHAP) + z-scores vs normal baseline.
- `training/retraining_experiment.py` - baseline vs candidate on the same held-out future test set; configurable criteria; deployment only via explicit confirmation.
  Try harder cases: `python -m training.retraining_experiment --drift 0 --future-train-fraction 0.05` (candidate may not improve).

## Backend layout
```
app/main.py            app wiring, lifespan (starts the simulation loop)
app/api/routes.py      simulation controls, live/history/alerts/settings REST, /ws/live WebSocket
app/ml_api.py          model info, explanations, retraining, deployment, versions, rollback
app/simulation/        sensor simulator (4 scenarios, smooth severity transitions, anomalies)
app/services/          scoring (model + risk thresholds), alert engine, config/settings, tick runner
app/database/db.py     SQLite (WAL): readings, alerts, events, settings; retention cleanup
app/schemas/models.py  Pydantic models and settings validation
app/ml/                registry (loads model), explain.py, versions.py
```

## Key endpoints (see /docs for all)
- Sim: POST /api/sim/start | pause | resume | reset, /api/sim/scenario/{normal|developing|severe|custom}, /api/sim/config {speed, interval}, /api/sim/custom {6 sensors}, /api/sim/inject-anomaly {spike|dropout}
- Live: GET /api/status, /api/live/recent?n=120, WebSocket ws://localhost:8000/ws/live (snapshot on connect, then one message per tick; send "ping" for "pong")
- History: GET /api/history, /api/history/summary, /api/history/export (CSV), /api/events (scenario/sim/model annotations); filters: start, end, scenario, min_risk_level
- Alerts: GET /api/alerts?status=&category=, POST /api/alerts/{id}/ack | resolve
- Settings: GET/PUT /api/settings (pump, simulation, risk thresholds, sensor thresholds, retention); POST /api/demo/reset-data?confirm=true
- Model: GET /api/model/metrics, /info, /versions, /explain/latest, /event-context/{alert_id}; POST /api/model/explain, /api/model/rollback {version, confirm}
- Retraining: POST /api/retraining/run, GET /api/retraining/latest, /history; POST /api/retraining/deploy {version, confirm}

## Behaviour notes
- Status = max(model class, level implied by configurable score thresholds). Statuses: Normal Operation, Possible Cavitation, High Cavitation Risk, Sensor/Data Error (missing/invalid sensor values are never scored), Model Unavailable.
- A high model score means readings resemble cavitation training examples; it is not a confirmed physical fault.
- Alerts need N consecutive ticks (persistence), are deduplicated per category while unresolved, have a cooldown (simulation seconds), and auto-resolve after 2N clear ticks.
- Sensor threshold alerts are rule-based and independent of the ML model.
- Simulation reset returns to the Normal scenario, clock 0, and reseeds the RNG (seed in settings) for reproducible demos. History is kept until reset-data.

## Simulation assumptions
Latent severity moves smoothly toward the scenario target (developing ramps over about 70 ticks). Low suction, flow instability,
discharge fluctuation and vibration share a transient term, so they move together. Noise, ~1% vibration spikes and ~0.5% sensor dropouts are injected.
Units: bar abs, m3/h, mm/s RMS, degC, rpm. This is not a physical pump model.
Six months is a proposed review interval, not an established optimum. The KS shift check works on simulated data only.
