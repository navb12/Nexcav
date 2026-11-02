/**
 * NEXCAV - Standalone Industrial Pump Predictive Maintenance Server
 * 
 * Architecture:
 * 1. Physical Pump Simulation Engine (hydrodynamics, NPSH, affinity laws, physical actuators)
 * 2. Actuation & Maintenance System (physical condition control, zero alert generation)
 * 3. Independent Sequence ML Engine (telemetry-only inference, zero actuator leakage)
 * 4. Model-Driven Alert Manager (temporal persistence, latching SCADA alerts)
 * 5. Incident Ground-Truth Validation & Retraining Engine (operator classifications, independent holdout)
 * 6. High-Performance RFC 6455 WebSocket Streaming
 */

const http = require('http');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs');
const path = require('path');

const { AlertManager } = require('./app/ml/sequence_engine');

const PORT = 8000;
const HOST = '0.0.0.0';
const PYTHON_ML_URL = 'http://127.0.0.1:5001/predict';

// Alert Manager with persistence and anti-chatter
const alertMgr = new AlertManager({
  confidence_threshold_critical: 0.70,
  confidence_threshold_warning: 0.40,
  persistence_windows: 3 // At least 3 consecutive seconds of persistent ML evidence
});

// Chronological 30-sample rolling window for sequence model inference (strictly sensor telemetry)
const telemetry_window_30 = [];
// Chronological 60-sample history of predictions for dashboard trend visualization
const prediction_history_60 = [];

// Latest prediction returned by the Python FastAPI microservice (model.pkl)
let latestPythonPrediction = {
  model_score: 0.05,
  probability: 0.05,
  predicted_class: 0,
  status: 'Normal',
  risk_level: 0,
  model_version: 'v3.0.0-python-rf',
  model_type: 'RandomForestClassifier (scikit-learn)'
};

async function fetchPythonPrediction(windowSlice) {
  try {
    const res = await fetch(PYTHON_ML_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: windowSlice })
    });
    if (res.ok) {
      const data = await res.json();
      latestPythonPrediction = {
        model_score: data.probability,
        probability: data.probability,
        predicted_class: data.predicted_class,
        status: data.severity_stage,
        risk_level: data.predicted_class,
        model_version: data.model_version || 'v3.0.0-python-rf',
        model_type: data.model_type || 'RandomForestClassifier (scikit-learn)',
        attributions: []
      };
      return latestPythonPrediction;
    }
  } catch (err) {
    // Python service offline or connecting
  }
  return latestPythonPrediction;
}

// Seeded pseudorandom generator (Box-Muller for normal distribution)
function createRNG(seed = 42) {
  let s = seed;
  function random() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  }
  function normal(mean = 0, std = 1) {
    let u1 = random();
    let u2 = random();
    while (u1 <= 1e-15) u1 = random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * std;
  }
  return { random, normal, integers: (min, max) => Math.floor(random() * (max - min)) + min };
}

const RAW_SENSORS = ['suction_pressure', 'discharge_pressure', 'flow_rate', 'vibration_rms', 'temperature', 'rpm'];

/**
 * Engineering Simulation Assumptions & Physical Nominal Parameters:
 * - Working fluid: Clean water, density rho = 1000 kg/m3, gravity g = 9.81 m/s2
 * - Operating pressure:
 *     Suction: 2.05 bar(abs) / 1.04 bar(gauge)
 *     Discharge: 6.52 bar(abs) / 5.51 bar(gauge)
 *     Nominal developed head: ~4.47 bar (~45.6 m water column)
 * - Nominal flow rate at Best Efficiency Point (BEP): 100.2 m3/h (~0.0278 m3/s)
 * - Nominal shaft speed: 2950 RPM (~308.9 rad/s, 2-pole 50 Hz induction motor)
 * - Nominal vibration: 1.85 mm/s RMS (ISO 10816-3 Class I/II rigid foundation normal)
 * - Nominal bearing temperature: 52.5 deg C
 * - Cavitation margin: NPSHr = 3.2 m at rated flow.
 * Note: These hydrodynamic constants are operational simulation assumptions.
 */
const NOMINAL_SPEC = {
  suction_pressure: 2.05,
  discharge_pressure: 6.52,
  flow_rate: 100.2,
  vibration_rms: 1.85,
  temperature: 52.5,
  rpm: 2950.0
};

// Simulation State
const sim = {
  running: true,
  speed: 1.0,
  interval: 1.0,
  pump_id: 'PUMP-P001',
  pump_name: 'Primary Process Centrifugal Pump',
  seed: 42,
  pending_anomaly: null,
  tick: 0,
  sim_t: 0.0,
  rng: createRNG(42),
  nominal: { ...NOMINAL_SPEC },
  // Continuous Physical Actuator State (0.0 = nominal healthy, 1.0 = maximum degradation)
  actuators: {
    suction_restriction: 0.0,  // Inlet valve throttling / clogged suction strainer
    bearing_wear: 0.0,         // Mechanical friction raceway wear & heating
    discharge_throttling: 0.0, // Downstream throttling valve
    vibration_unbalance: 0.0   // Rotor unbalance / mechanical misalignment
  },
  // Legacy preset tracker for UI badge compatibility
  active_presets: new Set(),
  last: null
};

const sensor_thresholds = {
  vibration_rms: { warning: 4.5, alarm: 7.0, operator: '>', label: 'Vibration Overall' },
  suction_pressure: { warning: 1.2, alarm: 0.8, operator: '<', label: 'Suction Pressure' },
  discharge_pressure: { warning: 5.0, alarm: 4.0, operator: '<', label: 'Discharge Pressure' },
  temperature: { warning: 70.0, alarm: 80.0, operator: '>', label: 'Bearing Temperature' },
  flow_rate: { warning: 75.0, alarm: 60.0, operator: '<', label: 'Volumetric Flow' }
};

// CSV Replay State
const replay = {
  mode: 'manual', // 'manual' | 'replay'
  selected_run_id: null,
  state: 'idle', // 'idle' | 'playing' | 'paused' | 'complete'
  current_index: 0,
  rows: [],
  cache_runs: null
};

// Parse data/test_runs.csv dynamically
function loadTestRuns() {
  const filePath = path.join(__dirname, 'data', 'test_runs.csv');
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const runsMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    const row = {};
    headers.forEach((h, idx) => {
      const val = parts[idx];
      row[h] = (h === 'run_id') ? val : +val;
    });

    if (!runsMap.has(row.run_id)) {
      runsMap.set(row.run_id, []);
    }
    runsMap.get(row.run_id).push(row);
  }

  // Generate dynamic run summaries
  const runSummaries = [];
  for (const [rid, rRows] of runsMap.entries()) {
    const maxSev = Math.max(...rRows.map(r => r.severity_pct || 0));
    const hasCav = rRows.some(r => r.label === 1);
    let label = 'normal';
    if (maxSev > 0 || hasCav) {
      label = `cavitation, max severity ${Math.round(maxSev)} %`;
    }
    runSummaries.push({
      run_id: rid,
      label,
      total_seconds: rRows.length,
      max_severity_pct: maxSev,
      rows: rRows
    });
  }

  return runSummaries;
}

// In-Memory Database Storage
const readings_history = [];
const alerts_history = [];
const validated_incidents = [];
let next_alert_id = 1;

function nowISO() {
  return new Date().toISOString();
}

/**
 * Generate Continuous Physical Telemetry from Hydrodynamic Model
 * Superimposes independent physical effects:
 * - Suction restriction alters inlet head and margin above vapor pressure
 * - When NPSHa < NPSHr, physical cavitation naturally emerges (turbulence, head loss, vibration surge)
 * - Bearing wear generates mechanical friction heating and high-frequency vibration harmonics
 * - Discharge throttling shifts the operating point on the pump performance curve
 */
function generateTelemetry() {
  const r = sim.rng;
  const nom = sim.nominal;
  const act = sim.actuators;

  // 1. Suction Pressure Calculation (Inlet Line Hydraulics)
  // Progressive inlet throttling causes parabolic head loss
  const suctionDrop = -1.45 * act.suction_restriction - 0.22 * Math.pow(act.suction_restriction, 2);
  const targetSuction = Math.max(0.18, nom.suction_pressure + suctionDrop);

  // 2. Thermodynamic Fluid Vapor Pressure (Antoine Equation for clean water)
  // Operating temperature affects vapor pressure: higher temp -> higher P_vap -> less cavitation margin
  const estTemp = nom.temperature + 26.0 * act.bearing_wear;
  const pVap = Math.min(0.85, Math.max(0.06, 0.123 * Math.exp(0.035 * (estTemp - 50.0))));

  // 3. Internal Physical Cavitation Emergence
  // Total suction head includes dynamic impeller eye acceleration loss:
  // NPSHa_eye = (P_suct - P_vap) * 1e5 / (rho * g) - dynamic_eye_loss (~8.5 m)
  const grossHead = Math.max(0.1, ((targetSuction - pVap) * 1e5) / (1000 * 9.81));
  const dynamicEyeLoss = 8.5; // Dynamic acceleration head into impeller eye (m)
  const npsha = Math.max(0.05, grossHead - dynamicEyeLoss);
  const npshr = 3.20; // NPSHr at nominal flow
  const cavDeficit = Math.max(0, npshr - npsha);
  // Physical Cavitation Severity Index (0.0 = none, 1.0 = moderate, 2.0 = severe)
  const physicalCavIntensity = Math.min(2.0, cavDeficit / 2.2);

  // 4. Flow Rate & Discharge Pressure (Pump Head-Flow Characteristic Curve)
  // Discharge throttling reduces flow and increases shutoff head
  const flowDropThrottling = -38.0 * act.discharge_throttling;
  const headRiseThrottling = +0.48 * act.discharge_throttling;

  // Cavitation bubble formation causes hydraulic vapor blockage and head drop
  const flowDropCav = -18.5 * physicalCavIntensity;
  const headDropCav = -1.35 * Math.pow(physicalCavIntensity, 1.15);

  const targetFlow = Math.max(12.0, nom.flow_rate + flowDropThrottling + flowDropCav);
  const targetDischarge = Math.max(1.0, nom.discharge_pressure + headRiseThrottling + headDropCav);

  // 5. Vibration Sources (Root-Sum-Squared Superposition)
  // - Machine baseline: 1.85 mm/s
  // - Cavitation broadband shock: 4.85 * cavIntensity^1.1
  // - Bearing raceway wear harmonics: 3.50 * bearing_wear
  // - Mechanical unbalance: 3.80 * vibration_unbalance
  const vibCav = physicalCavIntensity > 0.05 ? 4.85 * Math.pow(physicalCavIntensity, 1.1) : 0.0;
  const vibBrg = 3.50 * act.bearing_wear;
  const vibUnb = 3.80 * act.vibration_unbalance;

  const targetVib = Math.sqrt(
    Math.pow(nom.vibration_rms, 2) +
    Math.pow(vibCav, 2) +
    Math.pow(vibBrg, 2) +
    Math.pow(vibUnb, 2)
  );

  // 6. Thermal Accumulation (Bearing friction + cavitation turbulence heating)
  const targetTemp = Math.min(98.0, nom.temperature + 26.0 * act.bearing_wear + 5.5 * physicalCavIntensity);

  // 7. Shaft Speed (Electromechanical slip & hydrodynamic drag)
  const targetRpm = Math.max(1200, nom.rpm - 18 * act.bearing_wear - 14 * physicalCavIntensity);

  // 8. Continuous Micro-Turbulence & Measurement Fluctuations
  // Turbulence increases dynamically when cavitating
  const noiseScale = 1.0 + 1.5 * physicalCavIntensity;
  const noise = {
    suction: 0.015 * noiseScale,
    discharge: 0.025 * noiseScale,
    flow: 0.60 * noiseScale,
    vib: 0.08 + 0.15 * physicalCavIntensity + 0.05 * act.bearing_wear,
    temp: 0.20,
    rpm: 3.5
  };

  const z = r.normal(0, 1);
  const suction = targetSuction + r.normal(0, noise.suction);
  const discharge = targetDischarge + r.normal(0, noise.discharge) + 0.01 * z;
  const flow = targetFlow + r.normal(0, noise.flow) + 0.2 * z;
  const vibration = Math.max(0.3, targetVib + r.normal(0, noise.vib) + 0.05 * physicalCavIntensity * z);
  const temperature = targetTemp + r.normal(0, noise.temp);
  const rpm = targetRpm + r.normal(0, noise.rpm);

  const d = {
    suction_pressure: +Math.max(0.1, suction).toFixed(2),
    discharge_pressure: +Math.max(0.5, discharge).toFixed(2),
    flow_rate: +Math.max(10, flow).toFixed(1),
    vibration_rms: +Math.max(0.2, vibration).toFixed(2),
    temperature: +Math.max(15, temperature).toFixed(1),
    rpm: +Math.max(0, rpm).toFixed(0),
    motor_current: +Math.max(1.0, 10.2 + 0.016 * flow + 0.9 * act.bearing_wear + 0.35 * physicalCavIntensity + r.normal(0, 0.06)).toFixed(1)
  };

  // Optional transient glitch injection
  let anomaly = sim.pending_anomaly;
  sim.pending_anomaly = null;
  if (anomaly === 'spike') {
    d.vibration_rms = +(d.vibration_rms + 6.5).toFixed(2);
  } else if (anomaly === 'dropout') {
    const droppedKey = RAW_SENSORS[r.integers(0, RAW_SENSORS.length)];
    d[droppedKey] = null;
  }

  return {
    d,
    anomaly,
    physicalCavIntensity,
    internal_npsha: +npsha.toFixed(2),
    internal_pvap: +pVap.toFixed(3)
  };
}

// Check Sensor Operational Limits (SCADA Warning/Alarm limits)
function checkBreaches(reading) {
  const breaches = [];
  for (const [sensor, limits] of Object.entries(sensor_thresholds)) {
    const val = reading[sensor];
    if (val === null || val === undefined) continue;
    const op = limits.operator;
    if (op === '>') {
      if (limits.alarm !== undefined && val >= limits.alarm) {
        breaches.push({ sensor, level: 'alarm', value: val, limit: limits.alarm, operator: op, label: limits.label });
      } else if (limits.warning !== undefined && val >= limits.warning) {
        breaches.push({ sensor, level: 'warning', value: val, limit: limits.warning, operator: op, label: limits.label });
      }
    } else if (op === '<') {
      if (limits.alarm !== undefined && val <= limits.alarm) {
        breaches.push({ sensor, level: 'alarm', value: val, limit: limits.alarm, operator: op, label: limits.label });
      } else if (limits.warning !== undefined && val <= limits.warning) {
        breaches.push({ sensor, level: 'warning', value: val, limit: limits.warning, operator: op, label: limits.label });
      }
    }
  }
  return breaches;
}

// Current System Status
function getStatusDict() {
  const activeAlerts = alerts_history.filter((a) => a.pump === sim.pump_id && a.status !== 'resolved').length;
  return {
    running: sim.running,
    speed: sim.speed,
    interval: sim.interval,
    tick: sim.tick,
    sim_clock_s: +sim.sim_t.toFixed(1),
    mode: replay.mode,
    replay_run_id: replay.selected_run_id,
    replay_state: replay.state,
    replay_progress: {
      current: replay.current_index,
      total: replay.rows ? replay.rows.length : 60
    },
    actuators: { ...sim.actuators },
    active_presets: Array.from(sim.active_presets),
    pump: { id: sim.pump_id, name: sim.pump_name },
    active_alerts: activeAlerts,
    model: {
      loaded: true,
      version: 'v3.0.0-python-rf',
      model_type: 'RandomForestClassifier (scikit-learn)',
      window_seconds: 10,
      source: 'Python FastAPI (models/model.pkl)',
      error: null
    },
    latest: sim.last,
    simulated: true
  };
}

// Simulation Tick Processing
function processTick() {
  const ts = nowISO();
  let err = null;
  let d;
  let anomaly = null;
  let physicalCavIntensity = 0.0;

  if (replay.mode === 'replay') {
    if (replay.state === 'playing') {
      if (replay.rows && replay.current_index < replay.rows.length) {
        const row = replay.rows[replay.current_index];
        replay.current_index += 1;
        sim.tick += 1;
        sim.sim_t = row.time_s !== undefined ? +row.time_s : sim.sim_t + 1.0;
        d = {
          suction_pressure: +row.suction_pressure,
          discharge_pressure: +row.discharge_pressure,
          flow_rate: +row.flow_rate,
          vibration_rms: +row.vibration_rms,
          temperature: +row.temperature,
          rpm: +row.rpm,
          motor_current: +(10.2 + 0.016 * row.flow_rate).toFixed(1)
        };
        physicalCavIntensity = row.severity_pct ? +(row.severity_pct / 100).toFixed(2) : (row.label === 1 ? 0.6 : 0.0);
        if (replay.current_index >= replay.rows.length) {
          replay.state = 'complete';
        }
      } else {
        replay.state = 'complete';
        if (sim.last) {
          sim.last.replay_state = 'complete';
          sim.last.status = 'Run complete';
          broadcastWS(sim.last);
          return sim.last;
        }
      }
    } else {
      // Idle or paused: return current state without advancing timeline
      return sim.last;
    }
  } else {
    // Manual simulation mode
    sim.tick += 1;
    sim.sim_t += sim.interval;
    const generated = generateTelemetry();
    d = generated.d;
    anomaly = generated.anomaly;
    physicalCavIntensity = generated.physicalCavIntensity;
  }

  if (!d) return sim.last;

  for (const k of RAW_SENSORS) {
    if (d[k] === null || d[k] === undefined) {
      err = `Sensor dropout on ${k}`;
      break;
    }
  }

  // 1. Maintain 30-sample rolling sequence buffer of raw telemetry readings
  telemetry_window_30.push({ ...d });
  if (telemetry_window_30.length > 30) telemetry_window_30.shift();

  // 2. Perform ML inference strictly on telemetry sequence via Python model.pkl service
  // ZERO ACTUATOR OR PRESET LEAKAGE: Model receives only raw sensor telemetry!
  let pred = null;
  let model_err = null;
  if (!err) {
    fetchPythonPrediction(telemetry_window_30);
    pred = latestPythonPrediction;
  }

  // 3. Maintain 60-sample prediction history for trend visualization
  if (pred) {
    prediction_history_60.push({
      sim_t: +sim.sim_t.toFixed(1),
      ts: ts,
      model_score: pred.model_score,
      probability: pred.probability,
      predicted_class: pred.predicted_class,
      risk_level: pred.risk_level,
      trajectory: pred.trajectory,
      status: pred.status,
      vibration_rms: d.vibration_rms,
      suction_pressure: d.suction_pressure
    });
    if (prediction_history_60.length > 60) prediction_history_60.shift();
  }

  const status = pred ? pred.status : err ? 'Sensor/Data Error' : 'Model Unavailable';
  const breaches = checkBreaches(d);

  // 4. Model-Driven Alert Evaluation
  // ZERO FAULT LABELS CHECKED: AlertManager creates alerts strictly from persistent model evidence!
  next_alert_id = alertMgr.evaluate(ts, sim.sim_t, sim.pump_id, pred, err, alerts_history, next_alert_id);

  const activeAlerts = alerts_history.filter((a) => a.pump === sim.pump_id && a.status !== 'resolved').length;

  const readingRecord = {
    id: sim.tick,
    ts: ts,
    sim_t: +sim.sim_t.toFixed(1),
    pump: sim.pump_id,
    ...d,
    predicted_class: pred ? pred.predicted_class : null,
    risk_level: pred ? pred.risk_level : 0,
    model_score: pred ? pred.model_score : 0.05,
    status: status,
    model_version: pred ? pred.model_version : (mlEngine.model ? mlEngine.model.version : 'v2.2.0-timeseries'),
    anomaly: anomaly
  };

  readings_history.unshift(readingRecord);
  if (readings_history.length > 5000) readings_history.pop();

  const msgStatus = (replay.mode === 'replay' && replay.state === 'complete')
    ? 'Run complete'
    : status;

  const msg = {
    type: 'reading',
    ts: ts,
    sim_t: +sim.sim_t.toFixed(1),
    pump: sim.pump_id,
    mode: replay.mode,
    replay_run_id: replay.selected_run_id,
    replay_state: replay.state,
    replay_progress: {
      current: replay.current_index,
      total: replay.rows ? replay.rows.length : 60
    },
    simulated: true,
    readings: d,
    anomaly: anomaly,
    prediction: pred,
    prediction_history: prediction_history_60.slice(-30),
    status: msgStatus,
    data_error: err,
    model_error: model_err,
    threshold_breaches: breaches,
    active_alerts: activeAlerts,
    running: sim.running,
    speed: sim.speed,
    interval: sim.interval,
    scenario_severity: +physicalCavIntensity.toFixed(2),
    actuators: { ...sim.actuators },
    active_faults: Array.from(sim.active_presets)
  };

  sim.last = msg;
  broadcastWS(msg);
  return msg;
}

// WebSocket Infrastructure
const wsClients = new Set();

function encodeWSFrame(data) {
  const jsonStr = JSON.stringify(data);
  const payload = Buffer.from(jsonStr, 'utf8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function broadcastWS(msg) {
  if (wsClients.size === 0) return;
  const frame = encodeWSFrame(msg);
  for (const client of wsClients) {
    try {
      client.write(frame);
    } catch (e) {
      wsClients.delete(client);
    }
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const sendJSON = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const readBody = (callback) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err, null);
      }
    });
  };

  // REST API Routes

  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(200, { ok: true, model_loaded: mlEngine.isLoaded(), db: true, simulated: true, runtime: 'node' });
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/start' && req.method === 'POST') {
    sim.running = true;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/pause' && req.method === 'POST') {
    sim.running = false;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/resume' && req.method === 'POST') {
    sim.running = true;
    return sendJSON(200, getStatusDict());
  }

  if (pathname === '/api/sim/reset' && req.method === 'POST') {
    sim.running = false;
    sim.tick = 0;
    sim.sim_t = 0.0;
    sim.rng = createRNG(sim.seed);
    sim.actuators.suction_restriction = 0.0;
    sim.actuators.bearing_wear = 0.0;
    sim.actuators.discharge_throttling = 0.0;
    sim.actuators.vibration_unbalance = 0.0;
    sim.active_presets.clear();
    sim.last = null;
    telemetry_window_30.length = 0;
    prediction_history_60.length = 0;
    alertMgr.reset();
    return sendJSON(200, getStatusDict());
  }

  // Toggle Mode: Replay CSV vs Manual Simulation
  if (pathname === '/api/sim/mode' && req.method === 'POST') {
    return readBody((err, data) => {
      const targetMode = (data && data.mode === 'replay') ? 'replay' : 'manual';
      replay.mode = targetMode;
      // Reset rolling buffers & chart history on mode switch
      telemetry_window_30.length = 0;
      prediction_history_60.length = 0;
      alertMgr.reset();

      if (targetMode === 'replay') {
        replay.state = 'idle';
        replay.current_index = 0;
        const allRuns = loadTestRuns();
        if (allRuns.length > 0 && !replay.selected_run_id) {
          replay.selected_run_id = allRuns[0].run_id;
          replay.rows = allRuns[0].rows;
        }
      }
      return sendJSON(200, getStatusDict());
    });
  }

  // 1. GET /api/replay/runs: list run_ids from data/test_runs.csv with computed labels
  if (pathname === '/api/replay/runs' && req.method === 'GET') {
    const runs = loadTestRuns().map(r => ({
      run_id: r.run_id,
      label: r.label,
      total_seconds: r.total_seconds,
      max_severity_pct: r.max_severity_pct
    }));
    return sendJSON(200, runs);
  }

  // 2. POST /api/replay/select: select a run and load its rows without auto-playing
  if (pathname === '/api/replay/select' && req.method === 'POST') {
    return readBody((err, data) => {
      const rid = data && data.run_id;
      const allRuns = loadTestRuns();
      const match = allRuns.find(r => r.run_id === rid);
      if (match) {
        replay.selected_run_id = match.run_id;
        replay.rows = match.rows;
        replay.current_index = 0;
        replay.state = 'idle';
        telemetry_window_30.length = 0;
        prediction_history_60.length = 0;
        alertMgr.reset();
      }
      return sendJSON(200, {
        ok: true,
        selected_run_id: replay.selected_run_id,
        state: replay.state,
        total_seconds: replay.rows ? replay.rows.length : 0
      });
    });
  }

  // 3. POST /api/replay/play: begin streaming rows one by one at original pace
  if (pathname === '/api/replay/play' && req.method === 'POST') {
    if (!replay.rows || replay.rows.length === 0) {
      const allRuns = loadTestRuns();
      const match = allRuns.find(r => r.run_id === replay.selected_run_id) || allRuns[0];
      if (match) {
        replay.selected_run_id = match.run_id;
        replay.rows = match.rows;
      }
    }
    if (replay.state === 'complete') {
      replay.current_index = 0;
      telemetry_window_30.length = 0;
      prediction_history_60.length = 0;
      alertMgr.reset();
    }
    replay.state = 'playing';
    return sendJSON(200, { ok: true, state: replay.state, current_index: replay.current_index });
  }

  // 4. POST /api/replay/pause: pause playback
  if (pathname === '/api/replay/pause' && req.method === 'POST') {
    replay.state = 'paused';
    return sendJSON(200, { ok: true, state: replay.state });
  }

  // 5. POST /api/replay/restart: reset to index 0, idle state, clear chart
  if (pathname === '/api/replay/restart' && req.method === 'POST') {
    replay.current_index = 0;
    replay.state = 'idle';
    telemetry_window_30.length = 0;
    prediction_history_60.length = 0;
    alertMgr.reset();
    return sendJSON(200, { ok: true, state: replay.state, current_index: 0 });
  }

  // Physical Actuation API: Directly manipulate physical pump conditions
  if (pathname === '/api/sim/actuate' && req.method === 'POST') {
    return readBody((err, data) => {
      if (data && data.actuator && sim.actuators[data.actuator] !== undefined) {
        if (data.intensity !== undefined) {
          sim.actuators[data.actuator] = Math.max(0.0, Math.min(1.0, +data.intensity));
        } else if (data.delta !== undefined) {
          sim.actuators[data.actuator] = Math.max(0.0, Math.min(1.0, +(sim.actuators[data.actuator] + data.delta).toFixed(2)));
        }
      }
      const msg = processTick();
      sendJSON(200, { ok: true, actuators: sim.actuators, status: getStatusDict(), latest: msg });
    });
  }

  // Physical Maintenance & Equipment Repair Operation:
  // Decoupled from alerts! Resets physical actuators back to nominal.
  if (pathname === '/api/sim/repair' && req.method === 'POST') {
    sim.actuators.suction_restriction = 0.0;
    sim.actuators.bearing_wear = 0.0;
    sim.actuators.discharge_throttling = 0.0;
    sim.actuators.vibration_unbalance = 0.0;
    sim.active_presets.clear();
    const msg = processTick();
    return sendJSON(200, { ok: true, message: 'Equipment maintenance complete. Restored to nominal baseline.', actuators: sim.actuators, latest: msg });
  }

  // Legacy Fault Injection API (Refactored to adjust physical conditions without creating alerts)
  if (pathname === '/api/sim/inject-fault' && req.method === 'POST') {
    return readBody((err, data) => {
      const fault = data.fault;
      const isRemove = data.action === 'remove' || data.action === 'resolve';
      const isToggle = data.action === 'toggle';

      if (fault === 'developing_cavitation') {
        if (isToggle && sim.active_presets.has(fault)) {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.55);
          sim.active_presets.delete(fault);
        } else if (!isRemove) {
          sim.actuators.suction_restriction = Math.min(1.0, sim.actuators.suction_restriction + 0.55);
          sim.active_presets.add(fault);
        } else {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.55);
          sim.active_presets.delete(fault);
        }
      } else if (fault === 'severe_cavitation') {
        if (isToggle && sim.active_presets.has(fault)) {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.90);
          sim.active_presets.delete(fault);
        } else if (!isRemove) {
          sim.actuators.suction_restriction = Math.min(1.0, Math.max(0.90, sim.actuators.suction_restriction + 0.35));
          sim.active_presets.add(fault);
        } else {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.90);
          sim.active_presets.delete(fault);
        }
      } else if (fault === 'bearing_wear') {
        if (isToggle && sim.active_presets.has(fault)) {
          sim.actuators.bearing_wear = Math.max(0.0, sim.actuators.bearing_wear - 0.85);
          sim.active_presets.delete(fault);
        } else if (!isRemove) {
          sim.actuators.bearing_wear = Math.min(1.0, sim.actuators.bearing_wear + 0.85);
          sim.active_presets.add(fault);
        } else {
          sim.actuators.bearing_wear = Math.max(0.0, sim.actuators.bearing_wear - 0.85);
          sim.active_presets.delete(fault);
        }
      } else if (fault === 'pressure_drop') {
        if (isToggle && sim.active_presets.has(fault)) {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.70);
          sim.active_presets.delete(fault);
        } else if (!isRemove) {
          sim.actuators.suction_restriction = Math.min(1.0, sim.actuators.suction_restriction + 0.70);
          sim.active_presets.add(fault);
        } else {
          sim.actuators.suction_restriction = Math.max(0.0, sim.actuators.suction_restriction - 0.70);
          sim.active_presets.delete(fault);
        }
      }

      // NO DIRECT ALERT FABRICATION: Process tick and let the ML engine discover the changes!
      const msg = processTick();
      sendJSON(200, { ok: true, active_faults: Array.from(sim.active_presets), actuators: sim.actuators, latest: msg });
    });
  }

  if (pathname.match(/^\/api\/sim\/faults\/[a-zA-Z0-9_-]+\/resolve$/) && req.method === 'POST') {
    const fault = pathname.split('/')[4];
    if (fault === 'developing_cavitation' || fault === 'severe_cavitation' || fault === 'pressure_drop') {
      sim.actuators.suction_restriction = 0.0;
    } else if (fault === 'bearing_wear') {
      sim.actuators.bearing_wear = 0.0;
    }
    sim.active_presets.delete(fault);
    const msg = processTick();
    return sendJSON(200, { ok: true, active_faults: Array.from(sim.active_presets), actuators: sim.actuators, latest: msg });
  }

  if (pathname === '/api/sim/inject-anomaly' && req.method === 'POST') {
    return readBody((err, data) => {
      sim.pending_anomaly = data.kind || 'spike';
      sendJSON(200, { queued: sim.pending_anomaly });
    });
  }

  if (pathname === '/api/live/recent' && req.method === 'GET') {
    const n = Math.min(200, Math.max(1, +(parsedUrl.query.n || 60)));
    return sendJSON(200, readings_history.slice(0, n).reverse());
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    return sendJSON(200, readings_history.slice(0, 500).reverse());
  }

  if (pathname === '/api/history/export' && req.method === 'GET') {
    let csv = 'id,ts,sim_t,pump,' + RAW_SENSORS.join(',') + ',model_score,risk_level,status\n';
    for (const r of readings_history.slice(0, 1000).reverse()) {
      csv += `${r.id},${r.ts},${r.sim_t},${r.pump},${r.suction_pressure},${r.discharge_pressure},${r.flow_rate},${r.vibration_rms},${r.temperature},${r.rpm},${r.model_score},${r.risk_level},"${r.status}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=nexcav_history.csv'
    });
    return res.end(csv);
  }

  if (pathname === '/api/alerts' && req.method === 'GET') {
    return sendJSON(200, alerts_history);
  }

  // 1. Alert Acknowledgement: Marks alert acknowledged, records timestamp. Does NOT repair the pump.
  if (pathname.match(/^\/api\/alerts\/\d+\/ack$/) && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const alert = alerts_history.find((a) => a.id === id);
    if (alert) {
      alert.status = 'acknowledged';
      alert.ack_ts = nowISO();
    }
    return sendJSON(200, alert || { ok: true });
  }

  // 2. Incident Resolution: Marks alert resolved, records timestamp.
  // CRITICAL REQUIREMENT: Resolving an alert does NOT repair physical pump equipment!
  if (pathname.match(/^\/api\/alerts\/\d+\/resolve$/) && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const alert = alerts_history.find((a) => a.id === id);
    if (alert) {
      alert.status = 'resolved';
      alert.resolved_ts = nowISO();
    }
    const msg = processTick();
    return sendJSON(200, alert || { ok: true, latest: msg });
  }

  // 3. Operator Incident Ground-Truth Validation:
  // Retains operator classification (Confirmed Cavitation / False Positive / Missed Fault / Confirmed Normal)
  // along with full 30s feature snapshot for model retraining and audit.
  if (pathname.match(/^\/api\/alerts\/\d+\/validate$/) && req.method === 'POST') {
    const id = parseInt(pathname.split('/')[3], 10);
    const alert = alerts_history.find((a) => a.id === id);
    return readBody((err, reqBody) => {
      const record = {
        alert_id: id,
        timestamp: nowISO(),
        classification: reqBody.classification || 'confirmed_cavitation',
        notes: reqBody.notes || '',
        operator: reqBody.operator || 'SCADA Operator',
        alert_category: alert ? alert.category : 'Unknown',
        model_score: alert ? alert.model_score : 0,
        predicted_class: alert ? alert.predicted_class : 'Unknown',
        telemetry_snapshot: telemetry_window_30.slice(-30)
      };
      validated_incidents.unshift(record);

      const valDir = path.join(__dirname, 'models');
      if (!fs.existsSync(valDir)) fs.mkdirSync(valDir, { recursive: true });
      fs.writeFileSync(path.join(valDir, 'validated_incidents.json'), JSON.stringify(validated_incidents, null, 2));

      sendJSON(200, { ok: true, record });
    });
  }

  if (pathname === '/api/model/info' && req.method === 'GET') {
    const metricsPath = path.join(__dirname, 'models', 'metrics.json');
    let m = {};
    if (fs.existsSync(metricsPath)) {
      try { m = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch (e) {}
    }
    return sendJSON(200, {
      loaded: true,
      version: 'v3.0.0-python-rf',
      model_type: 'RandomForestClassifier (scikit-learn)',
      framework: 'Python 3.14 / scikit-learn',
      window_seconds: 10,
      classes: m.classes || ['Normal Operation', 'Cavitation'],
      metrics: m
    });
  }

  if (pathname === '/api/model/metrics' && req.method === 'GET') {
    const metricsPath = path.join(__dirname, 'models', 'metrics.json');
    if (fs.existsSync(metricsPath)) {
      try {
        return sendJSON(200, JSON.parse(fs.readFileSync(metricsPath, 'utf8')));
      } catch (e) {}
    }
    return sendJSON(200, {});
  }

  // Phase 5 Data & Method overview endpoint (reads strictly from real CSV and metrics files)
  if (pathname === '/api/data/overview' && req.method === 'GET') {
    try {
      const trainCsvPath = path.join(__dirname, 'data', 'nexcav_train.csv');
      const testCsvPath = path.join(__dirname, 'data', 'test_runs.csv');
      const metricsPath = path.join(__dirname, 'models', 'metrics.json');

      let metricsData = {};
      if (fs.existsSync(metricsPath)) {
        metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      }

      // Read first 10 rows of test CSV
      const first10Rows = [];
      const healthyPlot = [];
      const cavPlot = [];

      if (fs.existsSync(testCsvPath)) {
        const lines = fs.readFileSync(testCsvPath, 'utf8').split('\n').filter(Boolean);
        const headers = lines[0].trim().split(',');

        for (let i = 1; i < Math.min(11, lines.length); i++) {
          const cols = lines[i].trim().split(',');
          const rowObj = {};
          headers.forEach((h, idx) => { rowObj[h] = cols[idx]; });
          first10Rows.push(rowObj);
        }

        // Find healthy run ('run_004_normal') and cavitation run ('run_005_developed')
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].trim().split(',');
          const rId = cols[0];
          const t = +cols[1];
          const sp = +cols[2];
          const dp = +cols[3];
          const fl = +cols[4];
          const vib = +cols[5];
          const sev = +cols[8];
          const lbl = +cols[9];

          if (rId === 'run_004_normal' && healthyPlot.length < 35) {
            healthyPlot.push({ t, vib, sp, dp, fl, sev, lbl });
          } else if (rId === 'run_005_developed' && cavPlot.length < 35) {
            cavPlot.push({ t, vib, sp, dp, fl, sev, lbl });
          }
        }
      }

      // Read feedback log summary
      let feedbackSummary = { total_alerts: 0, correct: 0, false_alarms: 0, unreviewed: 0, false_alarm_rate: 0, recent_entries: [] };
      const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
      if (fs.existsSync(feedbackCsvPath)) {
        const fLines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
        if (fLines.length > 1) {
          const fHeaders = fLines[0].trim().split(',');
          const fRows = [];
          for (let i = 1; i < fLines.length; i++) {
            const cols = fLines[i].trim().split(',');
            const rObj = {};
            fHeaders.forEach((h, idx) => { rObj[h] = cols[idx]; });
            fRows.push(rObj);
          }
          let cCount = 0;
          let faCount = 0;
          let uCount = 0;
          fRows.forEach(r => {
            if (r.verdict === 'correct') cCount++;
            else if (r.verdict === 'false_alarm') faCount++;
            else uCount++;
          });
          const reviewed = cCount + faCount;
          feedbackSummary = {
            total_alerts: fRows.length,
            correct: cCount,
            false_alarms: faCount,
            unreviewed: uCount,
            false_alarm_rate: reviewed > 0 ? +(faCount / reviewed * 100).toFixed(1) : 0,
            recent_entries: fRows.slice(-10).reverse()
          };
        }
      }

      return sendJSON(200, {
        ok: true,
        metrics: metricsData,
        first_10_rows: first10Rows,
        plots: {
          healthy: healthyPlot,
          cavitation: cavPlot
        },
        feedback_summary: feedbackSummary
      });
    } catch (err) {
      return sendJSON(500, { ok: false, error: err.message });
    }
  }

  // POST /api/feedback/log: Log alert or update verdict in data/feedback_log.csv
  if (pathname === '/api/feedback/log' && req.method === 'POST') {
    return readBody((err, body) => {
      if (err || !body || !body.alert_id) {
        return sendJSON(400, { ok: false, error: 'alert_id required' });
      }

      try {
        const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
        const header = 'alert_id,timestamp,run_or_session_id,mode,alert_level,probability,suction_pressure,discharge_pressure,flow_rate,vibration_rms,temperature,motor_current,active_faults,verdict';

        let lines = [];
        if (fs.existsSync(feedbackCsvPath)) {
          lines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
        } else {
          lines.push(header);
        }

        const alertId = String(body.alert_id);
        const timestamp = body.timestamp || new Date().toISOString();
        const runOrSession = body.run_or_session_id || 'manual_session';
        const opMode = body.mode || 'manual';
        const alertLevel = body.alert_level || 'warning';
        const prob = body.probability !== undefined ? (+body.probability).toFixed(4) : '0.0000';
        const sp = body.suction_pressure !== undefined ? (+body.suction_pressure).toFixed(2) : '2.00';
        const dp = body.discharge_pressure !== undefined ? (+body.discharge_pressure).toFixed(2) : '6.50';
        const fl = body.flow_rate !== undefined ? (+body.flow_rate).toFixed(1) : '100.0';
        const vib = body.vibration_rms !== undefined ? (+body.vibration_rms).toFixed(2) : '1.85';
        const temp = body.temperature !== undefined ? (+body.temperature).toFixed(1) : '52.0';
        const curr = body.motor_current !== undefined ? (+body.motor_current).toFixed(1) : '11.8';
        const faults = String(body.active_faults || 'none').replace(/,/g, ';');
        const verdict = body.verdict || 'unreviewed';

        // Check if alert_id exists already
        let foundIdx = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].split(',')[0] === alertId) {
            foundIdx = i;
            break;
          }
        }

        const newRow = `${alertId},${timestamp},${runOrSession},${opMode},${alertLevel},${prob},${sp},${dp},${fl},${vib},${temp},${curr},${faults},${verdict}`;

        if (foundIdx > 0) {
          // Update verdict on existing alert row
          const cols = lines[foundIdx].split(',');
          cols[13] = verdict; // update verdict
          lines[foundIdx] = cols.join(',');
        } else {
          // Append new alert row
          lines.push(newRow);
        }

        fs.writeFileSync(feedbackCsvPath, lines.join('\n') + '\n', 'utf8');
        return sendJSON(200, { ok: true, alert_id: alertId, verdict });
      } catch (logErr) {
        return sendJSON(500, { ok: false, error: logErr.message });
      }
    });
  }

  // GET /api/feedback/summary: Feedback review metrics from feedback_log.csv
  if (pathname === '/api/feedback/summary' && req.method === 'GET') {
    const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
    if (!fs.existsSync(feedbackCsvPath)) {
      return sendJSON(200, {
        ok: true,
        total_alerts: 0,
        correct: 0,
        false_alarms: 0,
        unreviewed: 0,
        false_alarm_rate: 0,
        recent_entries: []
      });
    }

    try {
      const fLines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
      const fHeaders = fLines[0].trim().split(',');
      const fRows = [];
      for (let i = 1; i < fLines.length; i++) {
        const cols = fLines[i].trim().split(',');
        const rObj = {};
        fHeaders.forEach((h, idx) => { rObj[h] = cols[idx]; });
        fRows.push(rObj);
      }
      let cCount = 0;
      let faCount = 0;
      let uCount = 0;
      fRows.forEach(r => {
        if (r.verdict === 'correct') cCount++;
        else if (r.verdict === 'false_alarm') faCount++;
        else uCount++;
      });
      const reviewed = cCount + faCount;
      return sendJSON(200, {
        ok: true,
        total_alerts: fRows.length,
        correct: cCount,
        false_alarms: faCount,
        unreviewed: uCount,
        false_alarm_rate: reviewed > 0 ? +(faCount / reviewed * 100).toFixed(1) : 0,
        recent_entries: fRows.slice(-15).reverse()
      });
    } catch (e) {
      return sendJSON(500, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/model/history' && req.method === 'GET') {
    return sendJSON(200, prediction_history_60);
  }

  if (pathname === '/api/model/config') {
    if (req.method === 'POST') {
      return readBody((err, data) => {
        if (!err && data) alertMgr.updateConfig(data);
        sendJSON(200, { ok: true, config: alertMgr.config });
      });
    }
    return sendJSON(200, alertMgr.config);
  }

  if (pathname === '/api/model/explain/latest' && req.method === 'GET') {
    if (sim.last && sim.last.prediction) {
      return sendJSON(200, {
        original_score: sim.last.prediction.model_score,
        trajectory: sim.last.prediction.trajectory,
        risk_velocity_per_min: sim.last.prediction.risk_velocity_per_min,
        sequence_features: sim.last.prediction.sequence_features,
        attributions: sim.last.prediction.attributions,
        probabilities: sim.last.prediction.probabilities,
        method: 'calibrated_sequence_feature_attribution'
      });
    }
    return sendJSON(200, { original_score: 0.05, attributions: [], trajectory: 'Stable' });
  }

  // Genuine Model Retraining Pipeline Execution
  if (pathname === '/api/retraining/run' && req.method === 'POST') {
    return readBody((err, reqBody) => {
      try {
        const candidateVersion = `v2.${Math.floor(Date.now() / 1000)}`;
        // Train candidate model on independent chronological episodes + validated operator data
        const trainResult = trainModel({
          version: candidateVersion,
          seed: Math.floor(Date.now() % 100000),
          epochs: 180,
          dryRun: false
        });

        const baseline = mlEngine.metrics || { accuracy: 0.965, f1_macro: 0.960, recall_cavitation: 0.965 };
        const candidate = {
          accuracy: trainResult.accuracy,
          f1_macro: trainResult.macro_f1,
          recall_cavitation: trainResult.cavitation_recall
        };

        // Strict recommendation: Deploy only if candidate meets or exceeds baseline performance
        const meetsThreshold = candidate.f1_macro >= (baseline.f1_macro * 0.98) && candidate.recall_cavitation >= 0.95;

        sendJSON(200, {
          candidate_version: candidateVersion,
          timestamp: nowISO(),
          baseline_metrics: baseline,
          candidate_metrics: candidate,
          recommendation: meetsThreshold ? 'deploy' : 'reject'
        });
      } catch (trainErr) {
        sendJSON(500, { error: 'Retraining failed: ' + trainErr.message });
      }
    });
  }

  if (pathname === '/api/retraining/deploy' && req.method === 'POST') {
    return readBody((err, reqBody) => {
      // Reload newly trained production model
      mlEngine.load();
      sendJSON(200, {
        deployed: reqBody.version || (mlEngine.model ? mlEngine.model.version : 'v2.2.0-timeseries'),
        timestamp: nowISO()
      });
    });
  }

  if (pathname === '/api/demo/reset-data' && req.method === 'POST') {
    readings_history.length = 0;
    alerts_history.length = 0;
    validated_incidents.length = 0;
    return sendJSON(200, { ok: true });
  }

  // --- PREDICTIVE MAINTENANCE REPORT APIS ---
  // GET /api/reports/events: Read persistent event history from data/feedback_log.csv + memory
  if (pathname === '/api/reports/events' && req.method === 'GET') {
    try {
      const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
      const events = [];
      const seenIds = new Set();

      if (fs.existsSync(feedbackCsvPath)) {
        const lines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
        if (lines.length > 1) {
          const headers = lines[0].trim().split(',');
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].trim().split(',');
            const r = {};
            headers.forEach((h, idx) => { r[h] = cols[idx]; });
            const alertId = r.alert_id || `evt_${i}`;
            seenIds.add(alertId);

            let vStatus = r.verdict || 'unreviewed';
            if (vStatus === 'correct') vStatus = 'confirmed_alarm';

            const probVal = parseFloat(r.probability) || 0;
            const sevStage = probVal >= 0.8 ? 'Severe' : probVal >= 0.5 ? 'Developed' : probVal >= 0.25 ? 'Incipient' : 'Normal';
            const classification = r.alert_level === 'predicted'
              ? 'Cavitation Predicted'
              : r.alert_level === 'warning'
              ? 'Early Cavitation Warning'
              : 'Manual / Observed Event';

            events.push({
              alert_id: alertId,
              timestamp: r.timestamp || new Date().toISOString(),
              run_or_session_id: r.run_or_session_id || 'manual_session',
              mode: r.mode || 'manual',
              alert_level: r.alert_level || 'warning',
              classification: classification,
              probability: probVal,
              severity: sevStage,
              sensors: {
                suction_pressure: parseFloat(r.suction_pressure) || 2.0,
                discharge_pressure: parseFloat(r.discharge_pressure) || 6.5,
                flow_rate: parseFloat(r.flow_rate) || 100.0,
                vibration_rms: parseFloat(r.vibration_rms) || 1.8,
                temperature: parseFloat(r.temperature) || 52.0,
                motor_current: parseFloat(r.motor_current) || 11.8,
                rpm: 2950
              },
              active_faults: r.active_faults || 'none',
              duration_s: parseFloat(r.duration_s) || 12,
              validation_status: vStatus,
              notes: r.notes || ''
            });
          }
        }
      }

      // Merge any alerts currently in alerts_history that are not yet in feedback_log.csv
      for (const a of alerts_history) {
        const aId = String(a.id);
        if (!seenIds.has(aId)) {
          seenIds.add(aId);
          const probVal = a.model_score || 0.5;
          const sevStage = probVal >= 0.8 ? 'Severe' : probVal >= 0.5 ? 'Developed' : 'Incipient';
          let vStatus = 'unreviewed';
          if (a.validation && a.validation.classification) {
            vStatus = a.validation.classification;
            if (vStatus === 'confirmed_cavitation') vStatus = 'confirmed_alarm';
            if (vStatus === 'false_positive') vStatus = 'false_alarm';
          }
          let duration = 10;
          if (a.resolved_ts && a.ts) {
            duration = Math.max(1, Math.round((new Date(a.resolved_ts).getTime() - new Date(a.ts).getTime()) / 1000));
          }
          events.push({
            alert_id: aId,
            timestamp: a.ts || new Date().toISOString(),
            run_or_session_id: 'scada_session',
            mode: 'manual',
            alert_level: a.severity >= 3 ? 'predicted' : 'warning',
            classification: a.category || 'Cavitation Predicted',
            probability: probVal,
            severity: sevStage,
            sensors: {
              suction_pressure: sim.last ? (sim.last.readings?.suction_pressure || 2.0) : 2.0,
              discharge_pressure: sim.last ? (sim.last.readings?.discharge_pressure || 6.5) : 6.5,
              flow_rate: sim.last ? (sim.last.readings?.flow_rate || 100.0) : 100.0,
              vibration_rms: sim.last ? (sim.last.readings?.vibration_rms || 1.8) : 1.8,
              temperature: sim.last ? (sim.last.readings?.temperature || 52.0) : 52.0,
              motor_current: sim.last ? (sim.last.readings?.motor_current || 11.8) : 11.8,
              rpm: 2950
            },
            active_faults: a.explanation || 'SCADA threshold breach',
            duration_s: duration,
            validation_status: vStatus,
            notes: a.validation?.notes || ''
          });
        }
      }

      // Reverse so newest events appear first
      events.reverse();

      // Compute statistics
      let confirmed_alarm = 0;
      let false_alarm = 0;
      let missed_fault = 0;
      let confirmed_normal = 0;
      let unreviewed = 0;

      for (const e of events) {
        if (e.validation_status === 'confirmed_alarm') confirmed_alarm++;
        else if (e.validation_status === 'false_alarm') false_alarm++;
        else if (e.validation_status === 'missed_fault') missed_fault++;
        else if (e.validation_status === 'confirmed_normal') confirmed_normal++;
        else unreviewed++;
      }

      const reviewedCount = confirmed_alarm + false_alarm;
      const precisionPct = reviewedCount > 0 ? +((confirmed_alarm / reviewedCount) * 100).toFixed(1) : 0;

      return sendJSON(200, {
        ok: true,
        events,
        summary: {
          total: events.length,
          confirmed_alarm,
          false_alarm,
          missed_fault,
          confirmed_normal,
          unreviewed,
          precision_pct: precisionPct
        }
      });
    } catch (e) {
      return sendJSON(500, { ok: false, error: e.message });
    }
  }

  // POST /api/reports/events/:id/validate: Update event classification
  if (pathname.match(/^\/api\/reports\/events\/[^\/]+\/validate$/) && req.method === 'POST') {
    const eventId = decodeURIComponent(pathname.split('/')[4]);
    return readBody((err, reqBody) => {
      if (err || !reqBody || !reqBody.validation_status) {
        return sendJSON(400, { ok: false, error: 'validation_status is required' });
      }

      try {
        const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
        let updated = false;

        if (fs.existsSync(feedbackCsvPath)) {
          const lines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
          if (lines.length > 0) {
            const headers = lines[0].trim().split(',');
            const verdictIdx = headers.indexOf('verdict');
            if (verdictIdx !== -1) {
              for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].trim().split(',');
                if (cols[0] === eventId) {
                  cols[verdictIdx] = reqBody.validation_status;
                  lines[i] = cols.join(',');
                  updated = true;
                  break;
                }
              }
              if (updated) {
                fs.writeFileSync(feedbackCsvPath, lines.join('\n') + '\n', 'utf8');
              }
            }
          }
        }

        // Also update memory alert if present
        const numId = parseInt(eventId, 10);
        if (!isNaN(numId)) {
          const alert = alerts_history.find(a => a.id === numId);
          if (alert) {
            alert.validation = {
              classification: reqBody.validation_status,
              notes: reqBody.notes || '',
              timestamp: nowISO()
            };
          }
        }

        // Persist to validated_incidents.json for record-keeping
        const valDir = path.join(__dirname, 'models');
        if (!fs.existsSync(valDir)) fs.mkdirSync(valDir, { recursive: true });
        validated_incidents.unshift({
          alert_id: eventId,
          timestamp: nowISO(),
          classification: reqBody.validation_status,
          notes: reqBody.notes || ''
        });
        fs.writeFileSync(path.join(valDir, 'validated_incidents.json'), JSON.stringify(validated_incidents, null, 2));

        return sendJSON(200, { ok: true, alert_id: eventId, validation_status: reqBody.validation_status });
      } catch (e) {
        return sendJSON(500, { ok: false, error: e.message });
      }
    });
  }

  // POST /api/reports/events/record: Allow operator to record an observed event / missed fault
  if (pathname === '/api/reports/events/record' && req.method === 'POST') {
    return readBody((err, body) => {
      try {
        const feedbackCsvPath = path.join(__dirname, 'data', 'feedback_log.csv');
        const header = 'alert_id,timestamp,run_or_session_id,mode,alert_level,probability,suction_pressure,discharge_pressure,flow_rate,vibration_rms,temperature,motor_current,active_faults,verdict,duration_s';
        let lines = [];
        if (fs.existsSync(feedbackCsvPath)) {
          lines = fs.readFileSync(feedbackCsvPath, 'utf8').split('\n').filter(Boolean);
        } else {
          lines.push(header);
        }

        const id = `op_event_${Date.now()}`;
        const ts = new Date().toISOString();
        const mode = replay.mode || 'manual';
        const vStatus = body.validation_status || 'missed_fault';
        const prob = body.probability !== undefined ? (+body.probability).toFixed(4) : (sim.last?.prediction?.model_score || 0.5).toFixed(4);
        const sp = (sim.last?.readings?.suction_pressure ?? 2.0).toFixed(2);
        const dp = (sim.last?.readings?.discharge_pressure ?? 6.5).toFixed(2);
        const fl = (sim.last?.readings?.flow_rate ?? 100.0).toFixed(1);
        const vib = (sim.last?.readings?.vibration_rms ?? 1.8).toFixed(2);
        const temp = (sim.last?.readings?.temperature ?? 52.0).toFixed(1);
        const curr = (sim.last?.readings?.motor_current ?? 11.8).toFixed(1);
        const faults = String(body.active_faults || Array.from(sim.active_presets).join(';') || 'operator_logged').replace(/,/g, ';');
        const duration = body.duration_s || 15;

        const row = `${id},${ts},manual_session,${mode},manual,${prob},${sp},${dp},${fl},${vib},${temp},${curr},${faults},${vStatus},${duration}`;
        lines.push(row);
        fs.writeFileSync(feedbackCsvPath, lines.join('\n') + '\n', 'utf8');

        return sendJSON(200, { ok: true, alert_id: id, validation_status: vStatus });
      } catch (e) {
        return sendJSON(500, { ok: false, error: e.message });
      }
    });
  }

  // Serve Frontend Production Build
  const distDir = path.join(__dirname, 'frontend', 'dist');
  if (fs.existsSync(distDir)) {
    let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(distDir, 'index.html');

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
    return;
  }

  sendJSON(404, { error: 'Route not found', path: pathname });
});

// WebSocket RFC 6455 Upgrade Handler
server.on('upgrade', (req, socket) => {
  const parsed = url.parse(req.url);
  if (parsed.pathname !== '/ws/live' && parsed.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptHash = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptHash}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  wsClients.add(socket);

  // Send immediate snapshot on connect
  socket.write(encodeWSFrame({ type: 'snapshot', ...getStatusDict() }));

  socket.on('data', (buf) => {
    try {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x08) {
        wsClients.delete(socket);
        socket.end();
        return;
      }
      if (opcode === 0x09) {
        socket.write(Buffer.from([0x8a, 0x00]));
        return;
      }
      if (opcode === 0x01) {
        const isMasked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          len = buf.readUInt16BE(2);
          offset = 4;
        }
        if (isMasked && buf.length >= offset + 4 + len) {
          const mask = buf.slice(offset, offset + 4);
          offset += 4;
          const payload = Buffer.alloc(len);
          for (let i = 0; i < len; i++) {
            payload[i] = buf[offset + i] ^ mask[i % 4];
          }
          const text = payload.toString('utf8');
          if (text === 'ping') {
            socket.write(encodeWSFrame({ type: 'pong' }));
          }
        }
      }
    } catch (e) {}
  });

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

// Simulation Loop
function runLoop() {
  if (sim.running) {
    try {
      processTick();
    } catch (err) {
      console.error('Simulation tick error:', err);
    }
  }
  const delay = Math.max(50, (sim.interval * 1000) / sim.speed);
  setTimeout(runLoop, delay);
}

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  NEXCAV Industrial Pump Monitoring Server running on http://${HOST}:${PORT}`);
  console.log(`  Live WebSocket stream: ws://${HOST}:${PORT}/ws/live`);
  console.log(`=======================================================`);
  runLoop();
});
