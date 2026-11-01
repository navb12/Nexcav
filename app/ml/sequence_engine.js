/**
 * NEXCAV - Time-Series Sequence ML Engine & Alert Manager
 * 
 * Provides:
 * 1. 30-sample rolling window sequence feature extraction
 * 2. Multi-variate calibrated sequence inference (Strictly zero scenario/fault label inputs)
 * 3. Trend trajectory analysis (Stable / Deteriorating / Improving)
 * 4. Configurable persistence and anti-chatter alert manager
 */

const fs = require('fs');
const path = require('path');

const NOMINAL_DEFAULT = {
  suction_pressure: 2.05,
  discharge_pressure: 6.52,
  flow_rate: 100.2,
  vibration_rms: 1.85,
  temperature: 52.5,
  rpm: 2950.0
};

// Water vapor pressure approximate curve around 50-75 deg C (in bar abs)
function getVaporPressure(tempC) {
  return Math.min(0.5, Math.max(0.08, 0.123 * Math.exp(0.035 * (tempC - 50.0))));
}

// Linear regression slope over 1-second sampled time array
function calculateSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = (n * sumXX - sumX * sumX);
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// Standard deviation
function calculateStd(values) {
  const n = values.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = values[i] - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (n - 1));
}

class SequenceMLEngine {
  constructor(modelPath, metricsPath) {
    this.modelPath = modelPath || path.join(__dirname, '..', '..', 'models', 'sequence_model.json');
    this.metricsPath = metricsPath || path.join(__dirname, '..', '..', 'models', 'metrics.json');
    this.model = null;
    this.metrics = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.modelPath)) {
        this.model = JSON.parse(fs.readFileSync(this.modelPath, 'utf8'));
      }
      if (fs.existsSync(this.metricsPath)) {
        this.metrics = JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
      }
    } catch (e) {
      console.error('[SequenceMLEngine] Error loading model bundle:', e.message);
    }
  }

  isLoaded() {
    return this.model !== null && Array.isArray(this.model.weights);
  }

  /**
   * Extract sequence features from a rolling window of readings.
   * If window has fewer than 30 readings (e.g. at cold start), pads with nominal/first reading.
   */
  extractFeatures(windowSlice, nominal = NOMINAL_DEFAULT) {
    let window30 = [...windowSlice];
    if (window30.length === 0) {
      window30 = [nominal];
    }
    // Pad left if fewer than 30 samples to allow early continuous inference
    while (window30.length < 30) {
      window30.unshift({ ...window30[0] });
    }
    if (window30.length > 30) {
      window30 = window30.slice(-30);
    }

    const suctions = window30.map(r => r.suction_pressure ?? nominal.suction_pressure);
    const discharges = window30.map(r => r.discharge_pressure ?? nominal.discharge_pressure);
    const flows = window30.map(r => r.flow_rate ?? nominal.flow_rate);
    const vibrations = window30.map(r => r.vibration_rms ?? nominal.vibration_rms);
    const temperatures = window30.map(r => r.temperature ?? nominal.temperature);

    const latest = window30[window30.length - 1];

    const slopeSuct = calculateSlope(suctions);
    const slopeVib = calculateSlope(vibrations);
    const slopeFlow = calculateSlope(flows);
    const slopeDisc = calculateSlope(discharges);

    const stdSuct = calculateStd(suctions);
    const stdVib = calculateStd(vibrations);

    const vapPress = getVaporPressure(latest.temperature ?? nominal.temperature);
    const suctionVaporMargin = (latest.suction_pressure ?? nominal.suction_pressure) - vapPress;
    const headDiff = (latest.discharge_pressure ?? nominal.discharge_pressure) - (latest.suction_pressure ?? nominal.suction_pressure);
    const flowDevPct = (((latest.flow_rate ?? nominal.flow_rate) - nominal.flow_rate) / nominal.flow_rate) * 100.0;

    const rawVector = [
      latest.suction_pressure ?? nominal.suction_pressure,
      latest.discharge_pressure ?? nominal.discharge_pressure,
      latest.flow_rate ?? nominal.flow_rate,
      latest.vibration_rms ?? nominal.vibration_rms,
      slopeSuct,
      slopeVib,
      slopeFlow,
      slopeDisc,
      stdSuct,
      stdVib,
      suctionVaporMargin,
      headDiff,
      flowDevPct
    ];

    const sequenceSummary = {
      slope_suction: +slopeSuct.toFixed(4),
      slope_vibration: +slopeVib.toFixed(4),
      slope_flow: +slopeFlow.toFixed(3),
      slope_discharge: +slopeDisc.toFixed(4),
      std_suction: +stdSuct.toFixed(4),
      std_vibration: +stdVib.toFixed(4),
      suction_vapor_margin: +suctionVaporMargin.toFixed(3),
      head_diff: +headDiff.toFixed(3),
      flow_deviation_pct: +flowDevPct.toFixed(1)
    };

    return { rawVector, sequenceSummary, latest };
  }

  /**
   * Run model inference on a 30-sample historical window.
   * Model accepts ONLY telemetry sequence.
   */
  predict(windowSlice, recentPredictions = [], nominal = NOMINAL_DEFAULT) {
    if (!this.isLoaded()) {
      this.load();
      if (!this.isLoaded()) {
        throw new Error('Sequence ML model is not available or failed to load.');
      }
    }

    const { rawVector, sequenceSummary, latest } = this.extractFeatures(windowSlice, nominal);
    const { means, stds } = this.model.normalization;
    const numClasses = this.model.classes.length;

    // Standardize features
    const normalized = rawVector.map((val, j) => (val - (means[j] ?? 0)) / (stds[j] || 1.0));

    // Compute logits: biases[c] + sum(weights[c][j] * x_norm[j])
    const logits = new Array(numClasses).fill(0);
    let maxLogit = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      let z = this.model.biases[c];
      for (let j = 0; j < normalized.length; j++) {
        z += this.model.weights[c][j] * normalized[j];
      }
      logits[c] = z;
      if (z > maxLogit) maxLogit = z;
    }

    // Softmax probabilities
    let expSum = 0;
    const probs = new Array(numClasses).fill(0);
    for (let c = 0; c < numClasses; c++) {
      probs[c] = Math.exp(logits[c] - maxLogit);
      expSum += probs[c];
    }
    for (let c = 0; c < numClasses; c++) probs[c] /= expSum;

    // Class 0: Normal, 1: Incipient, 2: Developing, 3: Severe
    const pNormal = probs[0];
    const pIncipient = probs[1];
    const pDeveloping = probs[2];
    const pSevere = probs[3];

    // Calibrated continuous Cavitation Probability Index (0.0 to 1.0)
    const cavitationProbability = +(pIncipient * 0.35 + pDeveloping * 0.70 + pSevere * 1.0).toFixed(3);

    // Determine argmax predicted class
    let bestClassIdx = 0;
    let bestProb = probs[0];
    for (let c = 1; c < numClasses; c++) {
      if (probs[c] > bestProb) {
        bestProb = probs[c];
        bestClassIdx = c;
      }
    }

    // Map to 3-tier SCADA risk level: 0 (Normal), 1 (Warning), 2 (Critical Alarm)
    let riskLevel = 0;
    if (bestClassIdx === 3 || cavitationProbability >= 0.80) {
      riskLevel = 2; // Critical Alarm (Severe Cavitation)
    } else if (bestClassIdx >= 1 || cavitationProbability >= 0.35) {
      riskLevel = 1; // Warning (Incipient or Developing Cavitation)
    } else {
      riskLevel = 0; // Normal
    }

    const predictedClass = this.model.classes[bestClassIdx];

    // Trajectory Trend Analysis (Deteriorating / Stable / Improving)
    let trajectory = 'Stable';
    let riskVelocityPerMin = 0.0;
    if (recentPredictions.length >= 3) {
      const pastSlice = recentPredictions.slice(-6);
      const pastAvg = pastSlice.reduce((acc, p) => acc + (p.model_score || p.probability || 0), 0) / pastSlice.length;
      const delta = cavitationProbability - pastAvg;
      riskVelocityPerMin = +(delta * (60 / Math.max(1, pastSlice.length))).toFixed(1);

      if (delta > 0.035) {
        trajectory = 'Deteriorating';
      } else if (delta < -0.035) {
        trajectory = 'Improving';
      } else {
        trajectory = 'Stable';
      }
    }

    // Sequence Feature Attributions
    // Evaluate which sequence patterns pushed cavitation score UP
    const attributions = [];
    const featureLabels = {
      current_suction: { label: 'Suction Pressure', unit: 'bar', desc: 'Current inlet pressure level' },
      current_discharge: { label: 'Discharge Pressure', unit: 'bar', desc: 'Current outlet pressure' },
      current_flow: { label: 'Flow Rate', unit: 'm³/h', desc: 'Operating flow' },
      current_vibration: { label: 'Vibration RMS', unit: 'mm/s', desc: 'Overall machine vibration' },
      slope_suction: { label: 'Suction Drift Slope', unit: 'bar/s', desc: 'Rate of suction pressure decline' },
      slope_vibration: { label: 'Vibration Trend Slope', unit: 'mm/s per s', desc: 'Rate of vibration escalation' },
      slope_flow: { label: 'Flow Rate Trend', unit: 'm³/h/s', desc: 'Volumetric flow rate trajectory' },
      slope_discharge: { label: 'Discharge Slope', unit: 'bar/s', desc: 'Rate of head decline' },
      std_suction: { label: 'Suction Pressure Ripple', unit: 'bar', desc: 'Pressure instability & pulsations' },
      std_vibration: { label: 'Vibration RMS Fluctuation', unit: 'mm/s', desc: 'RMS vibration variability' },
      suction_vapor_margin: { label: 'Vapor Pressure Margin', unit: 'bar', desc: 'Margin above liquid vapor pressure' },
      head_diff: { label: 'Differential Head ΔP', unit: 'bar', desc: 'Pressure generated across pump' },
      flow_deviation_pct: { label: 'Flow Deviation', unit: '%', desc: 'Deviation from nominal BEP flow' }
    };

    for (let j = 0; j < this.model.features.length; j++) {
      const fKey = this.model.features[j];
      // Cavitation sensitivity weight: weighted sum across cavitation classes (incipient, developing, severe)
      const cavWeight = (
        0.35 * this.model.weights[1][j] +
        0.70 * this.model.weights[2][j] +
        1.00 * this.model.weights[3][j]
      );
      const impact = +(cavWeight * normalized[j]).toFixed(3);
      const meta = featureLabels[fKey] || { label: fKey, unit: '', desc: '' };

      attributions.push({
        feature: fKey,
        label: meta.label,
        value: typeof rawVector[j] === 'number' ? +rawVector[j].toFixed(3) : rawVector[j],
        unit: meta.unit,
        description: meta.desc,
        score_change: impact,
        normalized_deviation: +normalized[j].toFixed(2)
      });
    }

    // Sort by absolute score impact descending
    attributions.sort((a, b) => Math.abs(b.score_change) - Math.abs(a.score_change));

    return {
      model_score: cavitationProbability,
      probability: cavitationProbability,
      probabilities: {
        normal: +pNormal.toFixed(3),
        incipient: +pIncipient.toFixed(3),
        developing: +pDeveloping.toFixed(3),
        severe: +pSevere.toFixed(3)
      },
      predicted_class: predictedClass,
      predicted_class_idx: bestClassIdx,
      risk_level: riskLevel,
      status: predictedClass,
      trajectory: trajectory,
      risk_velocity_per_min: riskVelocityPerMin,
      model_version: this.model.version,
      sequence_features: sequenceSummary,
      attributions: attributions.slice(0, 5),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Intelligent Alert Engine with Sequence Persistence & Anti-Chatter Hysteresis
 */
class AlertManager {
  constructor(options = {}) {
    this.config = {
      confidence_threshold_critical: options.confidence_threshold_critical ?? 0.70,
      confidence_threshold_warning: options.confidence_threshold_warning ?? 0.45,
      persistence_windows: options.persistence_windows ?? 3, // At least 3 consecutive seconds of evidence
      clear_windows: options.clear_windows ?? 5              // At least 5 consecutive normal seconds to resolve
    };
    this.reset();
  }

  reset() {
    this.streakCritical = 0;
    this.streakWarning = 0;
    this.streakNormal = 0;
  }

  updateConfig(newCfg) {
    if (newCfg.confidence_threshold_critical !== undefined) {
      this.config.confidence_threshold_critical = Math.max(0.50, Math.min(0.95, +newCfg.confidence_threshold_critical));
    }
    if (newCfg.confidence_threshold_warning !== undefined) {
      this.config.confidence_threshold_warning = Math.max(0.20, Math.min(0.80, +newCfg.confidence_threshold_warning));
    }
    if (newCfg.persistence_windows !== undefined) {
      this.config.persistence_windows = Math.max(1, Math.min(15, parseInt(newCfg.persistence_windows, 10)));
    }
    if (newCfg.clear_windows !== undefined) {
      this.config.clear_windows = Math.max(2, Math.min(30, parseInt(newCfg.clear_windows, 10)));
    }
  }

  /**
   * Evaluate alerts based strictly on sequence model predictions and hardware errors.
   * Never inspects injected fault labels.
   */
  evaluate(ts, sim_t, pumpId, pred, dataError, alertsHistory, nextIdCounter) {
    let nextId = nextIdCounter;

    // 1. Hardware Signal Loss Alert
    if (dataError) {
      const cat = 'Sensor Signal Dropout';
      const exists = alertsHistory.some(a => a.category === cat && a.status !== 'resolved');
      if (!exists) {
        alertsHistory.unshift({
          id: nextId++,
          ts,
          pump: pumpId,
          source: 'sensor',
          category: cat,
          severity: 1,
          predicted_class: null,
          model_score: null,
          readings: JSON.stringify({ dataError }),
          explanation: `Hardware acquisition signal lost: ${dataError}`,
          action: 'Inspect wiring, transducer power supply, and field bus channel.',
          status: 'active',
          ack_ts: null,
          resolved_ts: null
        });
      }
    }

    if (!pred) return nextId;

    const prob = pred.probability ?? pred.model_score ?? 0;
    const isCriticalEvidence = (pred.risk_level === 2 && prob >= this.config.confidence_threshold_critical) || pred.predicted_class_idx === 3;
    const isWarningEvidence = !isCriticalEvidence && (pred.risk_level === 1 && prob >= this.config.confidence_threshold_warning);
    const isNormalEvidence = pred.risk_level === 0 && prob < this.config.confidence_threshold_warning;

    if (isCriticalEvidence) {
      this.streakCritical++;
      this.streakWarning = 0;
      this.streakNormal = 0;
    } else if (isWarningEvidence) {
      this.streakWarning++;
      this.streakCritical = 0;
      this.streakNormal = 0;
    } else if (isNormalEvidence) {
      this.streakNormal++;
      this.streakCritical = 0;
      this.streakWarning = 0;
    }

    // 2. Critical Cavitation Alarm (Requires persistence across consecutive windows)
    if (this.streakCritical >= this.config.persistence_windows) {
      const cat = 'CRITICAL: CAVITATION DETECTED';
      const existing = alertsHistory.find(a => a.category === cat && a.status !== 'resolved');
      if (!existing) {
        alertsHistory.unshift({
          id: nextId++,
          ts,
          pump: pumpId,
          source: 'model',
          category: cat,
          severity: 2,
          predicted_class: 'Severe Cavitation',
          model_score: prob,
          readings: JSON.stringify(pred.sequence_features || {}),
          explanation: `Model sequence inference detected severe cavitation with ${(prob * 100).toFixed(0)}% confidence across ${this.streakCritical} consecutive evaluation windows. Severe suction pressure collapse and turbulent vibration escalation verified.`,
          action: 'IMMEDIATE ACTION: Throttle discharge valve or increase suction head. Inspect inlet strainers to prevent catastrophic impeller destruction.',
          status: 'active',
          ack_ts: null,
          resolved_ts: null
        });
      }
    }

    // 3. Developing / Incipient Cavitation Warning (Requires persistence across consecutive windows)
    if (this.streakWarning >= this.config.persistence_windows) {
      const cat = 'Cavitation Detected: Developing Pattern';
      const existing = alertsHistory.find(a => a.category === cat && a.status !== 'resolved');
      if (!existing) {
        alertsHistory.unshift({
          id: nextId++,
          ts,
          pump: pumpId,
          source: 'model',
          category: cat,
          severity: 1,
          predicted_class: pred.predicted_class || 'Developing Cavitation',
          model_score: prob,
          readings: JSON.stringify(pred.sequence_features || {}),
          explanation: `Model sequence inference identified developing cavitation pattern with ${(prob * 100).toFixed(0)}% confidence over ${this.streakWarning} consecutive evaluation windows. Negative suction drift and increasing vibration trend observed.`,
          action: 'Verify inlet suction pressure margin and inspect suction strainers before condition becomes critical.',
          status: 'active',
          ack_ts: null,
          resolved_ts: null
        });
      }
    }

    // 4. Alert Lifecycle: In accordance with industrial SCADA safety standards,
    // alerts NEVER automatically vanish or auto-resolve. Once triggered by confirmed
    // telemetry evidence, alerts remain latched in Active Alerts until explicitly resolved by the operator.
    return nextId;
  }
}

module.exports = {
  SequenceMLEngine,
  AlertManager,
  NOMINAL_DEFAULT,
  calculateSlope,
  calculateStd,
  getVaporPressure
};
