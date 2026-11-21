# NexCav: Real-Time Cavitation Detection & Predictive Maintenance System

NexCav is an end-to-end industrial condition monitoring and predictive maintenance system for centrifugal pumps (specifically modeled on an industrial cooling/process pump, **Pump P-101** operating at 2,950 RPM).

The goal of this project is to detect **hydraulic cavitation in its early (incipient) stage** using real-time multi-sensor telemetry and machine learning before mechanical damage occurs to the impeller, mechanical seals, or bearings.

---

## The Problem: What is Cavitation?

In industrial plants, centrifugal pumps often suffer from cavitation. When suction pressure drops below the fluid's vapor pressure (due to clogged suction strainers, closed inlet valves, or low tank levels), microscopic vapor bubbles form inside the fluid stream.

As these bubbles travel into the higher-pressure region of the impeller, they collapse violently. Each implosion produces localized micro-jets with pressures up to 10,000 bar. Over time, this erodes the impeller blades, causes seal failure, destroys bearings, and leads to costly unplanned downtime.

Traditional plants usually rely on simple vibration alarms or wait until operators physically hear "gravel" inside the pump. By then, damage has already happened. NexCav uses machine learning to catch cavitation **10 to 30 seconds before** severe damage occurs, giving operators time to take corrective action.

---

## System Architecture

NexCav is built using a decoupled three-tier architecture:

```
[ Frontend Dashboard ]  <--- WebSocket (1 Hz) & REST --->  [ SCADA Gateway ]
  React 18 + TypeScript                                      Node.js (port 8000)
  Vite + Canvas + CSS                                                |
                                                                     | POST /predict
                                                                     v
                                                          [ ML Microservice ]
                                                            FastAPI (port 5001)
                                                            scikit-learn (model.pkl)
```

1. **Frontend (`frontend/`)**: Industrial SCADA dashboard built in React 18, TypeScript, and Vite. Renders real-time probability curves with Exponential Moving Average (EMA) smoothing at 60 FPS, an animated pump schematic, fault controls, and predictive maintenance reports.
2. **Backend SCADA Server (`server.js`)**: Node.js server running on port 8000. Handles first-principles physical simulation, RFC 6455 WebSocket streaming (`/ws/live`), CSV replay streaming, persistent alert latching, and REST endpoints.
3. **ML Microservice (`ml/serve.py`)**: Python FastAPI service running on port 5001. Receives rolling 10-second telemetry windows from the SCADA server, extracts rolling statistics, runs inference using a trained `RandomForestClassifier`, and returns real-time probabilities and severity stages.

---

## Key Features

### 1. Live Operations Dashboard
- **Mode Toggle**: Switch between **Manual Simulation** (injecting live faults) and **Replay CSV** (streaming recorded test runs row-by-row).
- **Smooth 60 FPS Probability Curve**: Live cavitation risk chart rendered via `requestAnimationFrame` with EMA filtering ($\alpha = 0.3$), fixed axes ($0-100\%$, rolling 30s window), and zero visual jitter.
- **Dynamic Margins**: Computes real-time **Severity Margin** (% headroom before alarm) and **Time to Threshold** (seconds remaining before crossing 50%, based on probability slope $dP/dt$).
- **Telemetry Strip**: Monospace tabular readout of 6 sensor channels: Suction Pressure, Discharge Pressure, Flow Rate, Vibration RMS, Motor Current, and Temperature.
- **Calm Pump Animation**: Visualizes the spinning impeller and cavitation bubble density without distracting screen shaking.

### 2. Physical Fault Injection & Technical Info
- 4 independent fault channels:
  - **Suction restriction** (drops suction pressure and NPSHa $\to$ triggers cavitation)
  - **Discharge throttling** (increases discharge head, reduces flow)
  - **Bearing wear** (increases friction, temperature, and raceway vibration)
  - **Rotor unbalance** (introduces 1X rotational vibration)
- **Physics Info Buttons (ⓘ)**: Beside each fault, a popover explains the fluid-mechanical consequences without altering the simulation or triggering false alarms.

### 3. Two-Stage Non-Blocking Alerts
- **Early Warning (25% threshold)**: Small amber top banner warning of rising risk during the incipient bubble stage.
- **Cavitation Predicted (50% threshold)**: Centered modal displaying the recommended corrective action (e.g., *"Increase suction valve opening"*). The backdrop is dimmed but non-blocking so operators can still view the live chart and adjust controls.
- **Audit Logging**: Every alert is logged with its full 6-sensor snapshot to `data/feedback_log.csv` for ground-truth validation.

### 4. Model Transparency Tab
- Displays genuine evaluation metrics evaluated on holdout test data:
  - Confusion Matrix
  - Accuracy, Precision, Recall, and F1-Score
  - ROC Curve with true Area Under Curve (AUC)
  - Gini Feature Importances (showing which sensors drive detection)
  - Dataset split sizes and class balance

### 5. Predictive Maintenance Report Tab
- **Pump Health Assessment**: Dynamic composite health score ($0-100$) and Maintenance Priority tag (`Low`, `Medium`, `High`, `Critical`).
- **Subsystem Breakdown**: Evaluates Hydraulic NPSH Margin, Mechanical Vibration (**ISO 10816-3 Class II** standards), Bearing Temperature, and Flow Delivery.
- **Evidence-Based Recommendations**: Generates actionable maintenance work orders based strictly on sensor deviations.
- **4-Way Event Validation**: Operators can review logged alerts and classify them as *Confirmed Alarm (TP)*, *False Alarm (FP)*, *Missed Fault (FN)*, or *Confirmed Normal (TN)*. Validation is completely decoupled from inference to prevent live model drift.
- **Print / PDF Export**: Built-in `@media print` stylesheet formatted for professional, high-contrast engineering maintenance reports.

---

## Machine Learning Details

### Dataset Generation (`data/generate_dataset.py`)
- Generated 100 independent operational runs (60 seconds each at 1 Hz = 6,000 rows).
- Features simulated: nominal baseline, incipient cavitation, developed cavitation, severe cavitation, varying ramp speeds, realistic industrial sensor noise, and borderline samples.
- **Clean Split**: 80% of runs saved to `data/nexcav_train.csv` (80 runs, 4,800 rows) and 20% to `data/test_runs.csv` (20 runs, 1,200 rows). Split is strictly by `run_id`—**zero data leakage** across train and test.

### Training & Evaluation (`ml/train.py`)
- **Model**: `RandomForestClassifier` (100 trees, scikit-learn).
- **Features**: Rolling 10-second window computing mean, standard deviation, and peak values across the sensor channels within each run boundary (18 total features).
- **Holdout Test Results**:
  - Accuracy: **~96.8%**
  - Precision: **~97.2%**
  - Recall: **~96.3%**
  - F1 Macro: **~0.97**
  - ROC-AUC: **~0.99**
- **Top Features**: The rolling standard deviation of suction pressure (`std_suction`) and broadband vibration (`vibration_rms`) were identified as the strongest early indicators of cavitation.

---

## Getting Started

### Prerequisites
- **Node.js** (v18 or higher)
- **Python** (v3.10 or higher)

### Installation

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd nexcav
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Install Node.js dependencies (for frontend and backend):
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

### Running the Application

To start both the Python ML inference service (port 5001) and the Node.js SCADA server (port 8000) with a single command:

```bash
npm start
```
*(Or directly: `node start_services.js`)*

Open your browser and navigate to:
```
http://localhost:8000
```

---

## Project Structure

```
nexcav/
├── server.js               # Node.js SCADA gateway, WebSocket engine, and REST APIs
├── start_services.js       # Unified launcher for Python ML + Node backend
├── package.json            # Root configuration and startup scripts
├── requirements.txt        # Python dependencies (FastAPI, scikit-learn, etc.)
│
├── ml/
│   ├── serve.py            # FastAPI microservice exposing POST /predict (port 5001)
│   ├── train.py            # Scikit-learn training script (evaluates on test_runs.csv)
│   └── retrain_with_feedback.py # Offline retraining script incorporating operator logs
│
├── data/
│   ├── generate_dataset.py # Physics-based dataset generator (100 runs, 80/20 split)
│   ├── nexcav_train.csv    # Training dataset (80 runs, 4,800 samples)
│   ├── test_runs.csv       # Unseen holdout test dataset (20 runs, 1,200 samples)
│   └── feedback_log.csv    # Persistent operator validation and alert audit log
│
├── models/
│   ├── model.pkl           # Trained Random Forest model bundle
│   └── metrics.json        # Evaluation metrics, confusion matrix, ROC points
│
└── frontend/               # React 18 + TypeScript + Vite UI
    ├── src/
    │   ├── App.tsx         # Main dashboard layout, navigation, and WebSocket client
    │   ├── types.ts        # TypeScript interfaces for telemetry and reports
    │   └── components/
    │       ├── CavitationProbabilityChart.tsx # 60 FPS EMA probability canvas
    │       ├── PredictiveMaintenanceReport.tsx # Health assessment & PDF export
    │       ├── MLMetricsPanel.tsx             # Confusion matrix & ROC-AUC diagnostics
    │       ├── PumpSchematic.tsx              # Blueprint pump & bubble animation
    │       └── DataMethodPanel.tsx            # Engineering whitepaper & run plots
    └── dist/               # Production frontend build served by server.js
```

---

## License & Academic Disclaimer

This project was built for academic demonstration and engineering research. Physical sensor telemetry and scenario responses are simulated based on standard centrifugal pump hydraulic curves (Pump P-101 baseline, 2,950 RPM).
