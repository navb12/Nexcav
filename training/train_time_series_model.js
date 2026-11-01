/**
 * NEXCAV - Time-Series ML Sequence Model Training Pipeline
 * 
 * Generates a physically plausible synthetic time-series dataset across distinct
 * operational episodes (Normal, Progressive Cavitation, Incipient Cavitation, 
 * Developing Cavitation, Severe Cavitation, Transient Noise Spikes, Non-Cavitation Bearing Wear).
 * 
 * Features:
 * - 30-sample rolling time window (1 Hz sampling)
 * - Sequence feature extraction: Linear regression slopes (dP/dt, dV/dt, dQ/dt), 
 *   30s rolling variance/std, physical differential head, suction vapor pressure margin, and flow deviation.
 * - Strict chronological train/test split by episode (zero sliding-window leakage).
 * - Multi-class regularized calibrated model with real weights and real validation metrics.
 * - Transparent documentation of synthetic nature in metrics metadata.
 */

const fs = require('fs');
const path = require('path');

// Reference Nominal Operating Parameters (Primary Process Centrifugal Pump)
const NOMINAL = {
  suction_pressure: 2.05,   // bar abs
  discharge_pressure: 6.52, // bar abs
  flow_rate: 100.2,         // m3/h
  vibration_rms: 1.85,      // mm/s RMS
  temperature: 52.5,        // deg C
  rpm: 2950.0               // RPM
};

// Water vapor pressure approximate curve around 50-75 deg C (in bar abs)
function getVaporPressure(tempC) {
  return Math.min(0.5, Math.max(0.08, 0.123 * Math.exp(0.035 * (tempC - 50.0))));
}

// Pseudo-random Gaussian generator with deterministic seed
function createRNG(seed = 42) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  }
  return {
    uniform(a, b) { return a + (b - a) * next(); },
    normal(mean = 0, std = 1) {
      const u1 = Math.max(1e-7, next());
      const u2 = next();
      return mean + std * Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }
  };
}

const CLASSES = [
  'Normal Operation',
  'Incipient Cavitation',
  'Developing Cavitation',
  'Severe Cavitation'
];

/**
 * Generate an operational episode of duration T seconds
 */
function generateEpisode(type, duration, rng) {
  const readings = [];
  const labels = [];

  let curSuction = NOMINAL.suction_pressure;
  let curDischarge = NOMINAL.discharge_pressure;
  let curFlow = NOMINAL.flow_rate;
  let curVib = NOMINAL.vibration_rms;
  let curTemp = NOMINAL.temperature;
  let curRpm = NOMINAL.rpm;

  for (let t = 0; t < duration; t++) {
    let targetClass = 0; // 0: Normal, 1: Incipient, 2: Developing, 3: Severe

    if (type === 'normal') {
      targetClass = 0;
      curSuction = NOMINAL.suction_pressure + rng.normal(0, 0.02);
      curDischarge = NOMINAL.discharge_pressure + rng.normal(0, 0.04);
      curFlow = NOMINAL.flow_rate + rng.normal(0, 0.8);
      curVib = NOMINAL.vibration_rms + rng.normal(0, 0.12);
      curTemp = NOMINAL.temperature + rng.normal(0, 0.25);
      curRpm = NOMINAL.rpm + rng.normal(0, 4.0);
    } 
    else if (type === 'progressive_cavitation') {
      // 0-30s normal, 30-55s incipient, 55-80s developing, 80s+ severe
      if (t < 30) {
        targetClass = 0;
        curSuction = NOMINAL.suction_pressure + rng.normal(0, 0.02);
        curDischarge = NOMINAL.discharge_pressure + rng.normal(0, 0.04);
        curFlow = NOMINAL.flow_rate + rng.normal(0, 0.8);
        curVib = NOMINAL.vibration_rms + rng.normal(0, 0.12);
      } else if (t < 55) {
        targetClass = 1; // Incipient
        const p = (t - 30) / 25;
        curSuction = 2.05 - 0.65 * p + rng.normal(0, 0.025);
        curDischarge = 6.52 - 0.30 * p + rng.normal(0, 0.04);
        curFlow = 100.2 - 5.4 * p + rng.normal(0, 1.0);
        curVib = 1.85 + 1.80 * p + rng.normal(0, 0.20);
      } else if (t < 80) {
        targetClass = 2; // Developing
        const p = (t - 55) / 25;
        curSuction = 1.40 - 0.35 * p + rng.normal(0, 0.035);
        curDischarge = 6.22 - 0.55 * p + rng.normal(0, 0.06);
        curFlow = 94.8 - 9.3 * p + rng.normal(0, 1.4);
        curVib = 3.65 + 1.80 * p + rng.normal(0, 0.30);
        curTemp += 0.04;
      } else {
        targetClass = 3; // Severe
        curSuction = 0.62 + rng.normal(0, 0.035);
        curDischarge = 4.35 + rng.normal(0, 0.07);
        curFlow = 71.8 + rng.normal(0, 1.8);
        curVib = 8.42 + rng.normal(0, 0.40);
        curTemp += 0.05;
      }
      curTemp = Math.min(75, Math.max(50, curTemp + rng.normal(0, 0.2)));
      curRpm = NOMINAL.rpm - (targetClass * 7) + rng.normal(0, 4.0);
    }
    else if (type === 'incipient_only') {
      if (t < 25) {
        targetClass = 0;
      } else {
        targetClass = 1;
        curSuction = 1.42 + rng.normal(0, 0.03);
        curDischarge = 6.25 + rng.normal(0, 0.04);
        curFlow = 94.8 + rng.normal(0, 0.9);
        curVib = 3.70 + rng.normal(0, 0.20);
      }
    }
    else if (type === 'developing_only') {
      if (t < 25) {
        targetClass = 0;
      } else {
        targetClass = 2;
        curSuction = 1.05 + rng.normal(0, 0.035);
        curDischarge = 5.65 + rng.normal(0, 0.06);
        curFlow = 85.5 + rng.normal(0, 1.2);
        curVib = 5.45 + rng.normal(0, 0.30);
      }
    }
    else if (type === 'severe_only') {
      if (t < 25) {
        targetClass = 0;
      } else {
        targetClass = 3;
        curSuction = 0.62 + rng.normal(0, 0.035);
        curDischarge = 4.35 + rng.normal(0, 0.07);
        curFlow = 71.8 + rng.normal(0, 1.8);
        curVib = 8.42 + rng.normal(0, 0.40);
      }
    }
    else if (type === 'transient_spike') {
      // Normal run with isolated 1-tick sensor noise spikes (Label must remain 0: Normal!)
      targetClass = 0;
      curSuction = NOMINAL.suction_pressure + rng.normal(0, 0.02);
      curDischarge = NOMINAL.discharge_pressure + rng.normal(0, 0.04);
      curFlow = NOMINAL.flow_rate + rng.normal(0, 0.8);
      curVib = NOMINAL.vibration_rms + rng.normal(0, 0.12);
      curTemp = NOMINAL.temperature + rng.normal(0, 0.25);
      curRpm = NOMINAL.rpm + rng.normal(0, 4.0);

      if (t === 45) {
        curVib += 5.5; // Single-tick spike
      } else if (t === 75) {
        curSuction -= 1.1; // Single-tick glitch
      }
    }
    else if (type === 'bearing_wear') {
      // High bearing temperature + high vibration, but normal suction and flow (Label 0: Not cavitation!)
      targetClass = 0;
      curSuction = NOMINAL.suction_pressure + rng.normal(0, 0.02);
      curDischarge = NOMINAL.discharge_pressure + rng.normal(0, 0.04);
      curFlow = NOMINAL.flow_rate + rng.normal(0, 0.8);
      curVib = 4.8 + rng.normal(0, 0.25);
      curTemp = 74.0 + rng.normal(0, 0.5);
      curRpm = 2930.0 + rng.normal(0, 6.0);
    }

    readings.push({
      suction_pressure: +Math.max(0.1, curSuction).toFixed(3),
      discharge_pressure: +Math.max(0.5, curDischarge).toFixed(3),
      flow_rate: +Math.max(10, curFlow).toFixed(2),
      vibration_rms: +Math.max(0.2, curVib).toFixed(3),
      temperature: +Math.max(15, curTemp).toFixed(2),
      rpm: +Math.max(0, curRpm).toFixed(1)
    });
    labels.push(targetClass);
  }

  return { type, readings, labels };
}

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

const FEATURE_KEYS = [
  'current_suction',
  'current_discharge',
  'current_flow',
  'current_vibration',
  'slope_suction',       // rate of suction pressure descent (bar/s)
  'slope_vibration',     // rate of RMS vibration climb (mm/s per s)
  'slope_flow',          // rate of flow change (m3/h per s)
  'slope_discharge',     // rate of discharge pressure change (bar/s)
  'std_suction',         // suction pressure fluctuation amplitude (bar)
  'std_vibration',       // vibration RMS variance (mm/s)
  'suction_vapor_margin',// P_suct - P_vap (bar)
  'head_diff',           // P_disc - P_suct (bar)
  'flow_deviation_pct'   // (Q - Q_nom) / Q_nom * 100 (%)
];

function extractSequenceFeatures(window30) {
  if (window30.length < 30) {
    throw new Error(`Window requires 30 samples, got ${window30.length}`);
  }

  const suctions = window30.map(r => r.suction_pressure);
  const discharges = window30.map(r => r.discharge_pressure);
  const flows = window30.map(r => r.flow_rate);
  const vibrations = window30.map(r => r.vibration_rms);

  const latest = window30[window30.length - 1];

  const slopeSuct = calculateSlope(suctions);
  const slopeVib = calculateSlope(vibrations);
  const slopeFlow = calculateSlope(flows);
  const slopeDisc = calculateSlope(discharges);

  const stdSuct = calculateStd(suctions);
  const stdVib = calculateStd(vibrations);

  const vapPress = getVaporPressure(latest.temperature);
  const suctionVaporMargin = latest.suction_pressure - vapPress;
  const headDiff = latest.discharge_pressure - latest.suction_pressure;
  const flowDevPct = ((latest.flow_rate - NOMINAL.flow_rate) / NOMINAL.flow_rate) * 100.0;

  return [
    latest.suction_pressure,
    latest.discharge_pressure,
    latest.flow_rate,
    latest.vibration_rms,
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
}

function trainModel() {
  console.log('=== NEXCAV Time-Series Sequence ML Training Pipeline ===');
  console.log('Generating synthetic time-series episodes with chronological split by regime...');

  const rng = createRNG(101);

  // Define operational episode groups
  const regimeConfig = [
    { type: 'normal', count: 18, duration: 100 },
    { type: 'progressive_cavitation', count: 18, duration: 110 },
    { type: 'incipient_only', count: 12, duration: 90 },
    { type: 'developing_only', count: 12, duration: 90 },
    { type: 'severe_only', count: 10, duration: 90 },
    { type: 'transient_spike', count: 8, duration: 90 },
    { type: 'bearing_wear', count: 8, duration: 90 }
  ];

  const trainEpisodes = [];
  const testEpisodes = [];

  // For each regime, place the first 70% in trainEpisodes and last 30% in held-out testEpisodes
  for (const reg of regimeConfig) {
    const numTrain = Math.floor(reg.count * 0.70);
    for (let i = 0; i < reg.count; i++) {
      const ep = generateEpisode(reg.type, reg.duration, rng);
      if (i < numTrain) {
        trainEpisodes.push(ep);
      } else {
        testEpisodes.push(ep);
      }
    }
  }

  console.log(`Generated ${trainEpisodes.length} training episodes and ${testEpisodes.length} held-out test episodes.`);

  function buildDataset(epList) {
    const X = [];
    const y = [];
    for (const ep of epList) {
      for (let t = 30; t <= ep.readings.length; t++) {
        const win = ep.readings.slice(t - 30, t);
        const feat = extractSequenceFeatures(win);
        const label = ep.labels[t - 1];
        X.push(feat);
        y.push(label);
      }
    }
    return { X, y };
  }

  const trainData = buildDataset(trainEpisodes);
  const testData = buildDataset(testEpisodes);

  console.log(`Extracted ${trainData.X.length} training sequence windows, ${testData.X.length} testing sequence windows.`);

  // Feature Standardization (fit on trainData only)
  const numFeatures = FEATURE_KEYS.length;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < trainData.X.length; i++) sum += trainData.X[i][j];
    means[j] = sum / trainData.X.length;

    let sumSq = 0;
    for (let i = 0; i < trainData.X.length; i++) {
      const diff = trainData.X[i][j] - means[j];
      sumSq += diff * diff;
    }
    stds[j] = Math.max(1e-5, Math.sqrt(sumSq / (trainData.X.length - 1)));
  }

  function standardize(X) {
    return X.map(row => row.map((val, j) => (val - means[j]) / stds[j]));
  }

  const X_train = standardize(trainData.X);
  const y_train = trainData.y;
  const X_test = standardize(testData.X);
  const y_test = testData.y;

  // Class distribution check
  const classCounts = [0, 0, 0, 0];
  y_train.forEach(c => classCounts[c]++);
  console.log('Train Class Distribution [Normal, Incipient, Developing, Severe]:', classCounts);

  const numClasses = CLASSES.length;
  const weights = Array.from({ length: numClasses }, () => new Array(numFeatures).fill(0));
  const biases = new Array(numClasses).fill(0);

  // Optimization: Mini-batch SGD with shuffling per epoch and learning rate schedule
  const epochs = 180;
  let lr = 0.05;
  const l2 = 0.0008;
  const N = X_train.length;

  const indices = Array.from({ length: N }, (_, i) => i);

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle indices
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rng.uniform(0, i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    if (epoch === 80) lr *= 0.5;
    if (epoch === 140) lr *= 0.5;

    for (let idx = 0; idx < N; idx++) {
      const i = indices[idx];
      const x = X_train[i];
      const target = y_train[i];

      const logits = new Array(numClasses).fill(0);
      let maxLogit = -Infinity;
      for (let c = 0; c < numClasses; c++) {
        let z = biases[c];
        for (let j = 0; j < numFeatures; j++) z += weights[c][j] * x[j];
        logits[c] = z;
        if (z > maxLogit) maxLogit = z;
      }

      let expSum = 0;
      const probs = new Array(numClasses).fill(0);
      for (let c = 0; c < numClasses; c++) {
        probs[c] = Math.exp(logits[c] - maxLogit);
        expSum += probs[c];
      }
      for (let c = 0; c < numClasses; c++) probs[c] /= expSum;

      // Update weights
      for (let c = 0; c < numClasses; c++) {
        const error = probs[c] - (c === target ? 1.0 : 0.0);
        biases[c] -= lr * error;
        for (let j = 0; j < numFeatures; j++) {
          weights[c][j] -= lr * (error * x[j] + l2 * weights[c][j]);
        }
      }
    }
  }

  console.log('Model training complete. Evaluating on held-out test episodes...');

  function predict(X) {
    const preds = [];
    const probabilities = [];

    for (let i = 0; i < X.length; i++) {
      const x = X[i];
      const logits = new Array(numClasses).fill(0);
      let maxLogit = -Infinity;
      for (let c = 0; c < numClasses; c++) {
        let z = biases[c];
        for (let j = 0; j < numFeatures; j++) z += weights[c][j] * x[j];
        logits[c] = z;
        if (z > maxLogit) maxLogit = z;
      }

      let expSum = 0;
      const probs = new Array(numClasses).fill(0);
      for (let c = 0; c < numClasses; c++) {
        probs[c] = Math.exp(logits[c] - maxLogit);
        expSum += probs[c];
      }
      for (let c = 0; c < numClasses; c++) probs[c] /= expSum;

      let bestClass = 0;
      let bestP = probs[0];
      for (let c = 1; c < numClasses; c++) {
        if (probs[c] > bestP) {
          bestP = probs[c];
          bestClass = c;
        }
      }

      preds.push(bestClass);
      probabilities.push(probs);
    }
    return { preds, probabilities };
  }

  const testEval = predict(X_test);
  const testPreds = testEval.preds;

  const cm = Array.from({ length: numClasses }, () => new Array(numClasses).fill(0));
  let correct = 0;
  for (let i = 0; i < y_test.length; i++) {
    const actual = y_test[i];
    const pred = testPreds[i];
    cm[actual][pred]++;
    if (actual === pred) correct++;
  }

  const accuracy = correct / y_test.length;

  const classPrecision = [];
  const classRecall = [];
  const classF1 = [];

  for (let c = 0; c < numClasses; c++) {
    let tp = cm[c][c];
    let fn = 0;
    let fp = 0;
    for (let p = 0; p < numClasses; p++) {
      if (p !== c) {
        fn += cm[c][p];
        fp += cm[p][c];
      }
    }
    const prec = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const rec = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (prec + rec) > 0 ? 2 * (prec * rec) / (prec + rec) : 0;

    classPrecision.push(prec);
    classRecall.push(rec);
    classF1.push(f1);
  }

  const macroF1 = classF1.reduce((a, b) => a + b, 0) / numClasses;

  let totalCavitationActual = 0;
  let detectedCavitation = 0;
  for (let i = 0; i < y_test.length; i++) {
    if (y_test[i] > 0) {
      totalCavitationActual++;
      if (testPreds[i] > 0) detectedCavitation++;
    }
  }
  const cavitationRecall = totalCavitationActual > 0 ? detectedCavitation / totalCavitationActual : 0;

  const featureImportances = FEATURE_KEYS.map((feat, j) => {
    let sumWeightSq = 0;
    for (let c = 1; c < numClasses; c++) {
      sumWeightSq += weights[c][j] * weights[c][j];
    }
    return { feature: feat, importance: Math.sqrt(sumWeightSq) };
  });

  const totalImp = featureImportances.reduce((acc, f) => acc + f.importance, 0) || 1;
  featureImportances.forEach(f => f.importance = +(f.importance / totalImp).toFixed(4));
  featureImportances.sort((a, b) => b.importance - a.importance);

  console.log(`Validation Results on Held-out Episodes:`);
  console.log(`- Accuracy: ${(accuracy * 100).toFixed(2)}%`);
  console.log(`- Macro F1: ${(macroF1 * 100).toFixed(2)}%`);
  console.log(`- Cavitation Recall: ${(cavitationRecall * 100).toFixed(2)}%`);
  console.log(`- Confusion Matrix:`);
  console.log('      [Pred: Normal, Incipient, Developing, Severe]');
  console.log('Act Normal:     ', cm[0]);
  console.log('Act Incipient:  ', cm[1]);
  console.log('Act Developing: ', cm[2]);
  console.log('Act Severe:     ', cm[3]);

  const modelDir = path.join(__dirname, '..', 'models');
  if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });

  const modelBundle = {
    version: 'v2.1.0-timeseries',
    model_type: 'CalibratedSoftmaxSequenceClassifier',
    window_seconds: 30,
    created_at: new Date().toISOString(),
    dataset_metadata: {
      type: 'synthetic_physical_time_series',
      note: 'Trained on physically modeled synthetic pump operation runs with strict chronological episode split.',
      train_episodes: trainEpisodes.length,
      test_episodes: testEpisodes.length,
      train_samples: trainData.X.length,
      test_samples: testData.X.length
    },
    classes: CLASSES,
    features: FEATURE_KEYS,
    normalization: { means, stds },
    weights,
    biases,
    validation_metrics: {
      accuracy: +accuracy.toFixed(4),
      macro_f1: +macroF1.toFixed(4),
      cavitation_recall: +cavitationRecall.toFixed(4),
      confusion_matrix: cm,
      class_f1: classF1.map(v => +v.toFixed(4))
    }
  };

  const metricsExport = {
    version: 'v2.1.0-timeseries',
    model_type: 'Time-Series Calibrated Sequence Classifier',
    dataset_source: 'Physically Plausible Synthetic Telemetry Dataset (Chronological Split)',
    trained_at: new Date().toISOString(),
    window_length_seconds: 30,
    accuracy: +accuracy.toFixed(4),
    f1_macro: +macroF1.toFixed(4),
    recall_cavitation: +cavitationRecall.toFixed(4),
    classes: CLASSES,
    confusion_matrix: cm,
    feature_importance: featureImportances
  };

  fs.writeFileSync(path.join(modelDir, 'sequence_model.json'), JSON.stringify(modelBundle, null, 2));
  fs.writeFileSync(path.join(modelDir, 'metrics.json'), JSON.stringify(metricsExport, null, 2));

  console.log(`Successfully exported trained model bundle to ${path.join(modelDir, 'sequence_model.json')}`);
  console.log(`Successfully exported validation metrics to ${path.join(modelDir, 'metrics.json')}`);
}

trainModel();
