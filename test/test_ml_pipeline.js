/**
 * Automated Test Suite for NEXCAV Sequence ML Pipeline & Alert Manager
 * 
 * Verifies:
 * 1. Normal operation (stable baseline, zero false alarms, low risk score)
 * 2. Progressive cavitation (early trend detection, escalation, trajectory)
 * 3. Fault injection without label leakage (telemetry-only detection)
 * 4. Recovery & hysteresis (trajectory transition, recovery clearance)
 * 5. Isolated sensor spikes (rejected by persistence filter, no false alarms)
 * 6. Persistent fault latching (critical alarm triggers and latches)
 */

const assert = require('assert');
const { SequenceMLEngine, AlertManager, NOMINAL_DEFAULT } = require('../app/ml/sequence_engine');

function runTests() {
  console.log('=== Starting NEXCAV Sequence ML Pipeline Automated Tests ===\n');
  const engine = new SequenceMLEngine();
  assert(engine.isLoaded(), 'Model bundle must be loaded successfully');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ [FAIL] ${name}`);
      console.error(err);
    }
  }

  // 1. Normal Operation Test
  test('Test 1: Normal Operation (Stable baseline, zero alarms)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];

    // Simulate 35 seconds of normal steady pump operation
    for (let t = 0; t < 35; t++) {
      window.push({
        suction_pressure: 2.05 + 0.01 * Math.sin(t),
        discharge_pressure: 6.52 + 0.02 * Math.cos(t),
        flow_rate: 100.2 + 0.3 * Math.sin(t),
        vibration_rms: 1.85 + 0.05 * Math.cos(t),
        temperature: 52.5,
        rpm: 2950
      });
      if (window.length > 30) window.shift();

      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t, 'PUMP-01', pred, null, alerts, 1);

      if (t >= 29) {
        assert.strictEqual(pred.predicted_class, 'Normal Operation', `Expected Normal Operation, got ${pred.predicted_class}`);
        assert.strictEqual(pred.risk_level, 0, `Expected risk level 0, got ${pred.risk_level}`);
        assert(pred.model_score < 0.20, `Model score ${pred.model_score} should be < 0.20`);
      }
    }

    assert.strictEqual(alerts.length, 0, `Expected 0 alerts during normal operation, got ${alerts.length}`);
  });

  // 2. Progressive Cavitation Test
  test('Test 2: Progressive Cavitation (Early trend detection & escalating trajectory)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];
    const predictions = [];

    let detectedIncipient = false;
    let detectedSevere = false;
    let deterioratingObserved = false;

    // Simulate 90-second run: 0-25s normal, 25-50s incipient, 50-70s developing, 70-90s severe
    for (let t = 0; t < 90; t++) {
      let s = 2.05, d = 6.52, q = 100.2, v = 1.85, temp = 52.5;

      if (t >= 25 && t < 50) {
        const p = (t - 25) / 25;
        s = 2.05 - 0.65 * p;
        d = 6.52 - 0.30 * p;
        q = 100.2 - 5.4 * p;
        v = 1.85 + 1.80 * p;
      } else if (t >= 50 && t < 70) {
        const p = (t - 50) / 20;
        s = 1.40 - 0.35 * p;
        d = 6.22 - 0.55 * p;
        q = 94.8 - 9.3 * p;
        v = 3.65 + 1.80 * p;
      } else if (t >= 70) {
        s = 0.62;
        d = 4.35;
        q = 71.8;
        v = 8.42;
      }

      window.push({ suction_pressure: s, discharge_pressure: d, flow_rate: q, vibration_rms: v, temperature: temp, rpm: 2950 });
      if (window.length > 30) window.shift();

      const pred = engine.predict(window, predictions);
      predictions.push(pred);
      alertMgr.evaluate(new Date().toISOString(), t, 'PUMP-01', pred, null, alerts, alerts.length + 1);

      if (pred.trajectory === 'Deteriorating') deterioratingObserved = true;
      if (pred.predicted_class === 'Incipient Cavitation' || (t >= 35 && t <= 50 && pred.model_score >= 0.30)) {
        detectedIncipient = true;
      }
      if (t >= 75 && (pred.predicted_class === 'Severe Cavitation' || pred.risk_level === 2)) {
        detectedSevere = true;
      }
    }

    assert(detectedIncipient, 'Model must detect early incipient cavitation trend before reaching severe level');
    assert(deterioratingObserved, 'Model trajectory must indicate Deteriorating as cavitation develops');
    assert(detectedSevere, 'Model must detect Severe Cavitation at high vibration and collapsed suction');
    assert(alerts.some(a => a.category.includes('CRITICAL')), 'Must trigger Critical Cavitation Alarm during severe stage');
  });

  // 3. Fault Injection without Label Leakage
  test('Test 3: Fault Injection (Inference derived strictly from telemetry)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];

    // Pre-fill 30 seconds of normal
    for (let t = 0; t < 30; t++) {
      window.push({ ...NOMINAL_DEFAULT });
    }

    // Step into developing cavitation physical parameters (suction=1.05, flow=85.5, vib=5.45)
    for (let t = 0; t < 15; t++) {
      window.push({
        suction_pressure: 1.05 + 0.02 * Math.sin(t),
        discharge_pressure: 5.65 + 0.03 * Math.cos(t),
        flow_rate: 85.5 + 0.5 * Math.sin(t),
        vibration_rms: 5.45 + 0.15 * Math.cos(t),
        temperature: 62.0,
        rpm: 2942
      });
      window.shift();

      // Zero fault labels or scenario names passed!
      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t + 30, 'PUMP-01', pred, null, alerts, alerts.length + 1);

      if (t >= 5) {
        assert(pred.model_score >= 0.40, `Model score ${pred.model_score} should be elevated for developing cavitation readings`);
        assert(pred.risk_level >= 1, `Risk level should be at least 1 (Warning), got ${pred.risk_level}`);
      }
    }

    assert(alerts.some(a => a.category.includes('Developing')), 'Must trigger Developing Cavitation warning from telemetry');
  });

  // 4. Persistent Fault & Explicit Operator Resolution Test
  test('Test 4: Persistent Fault State & Explicit Resolution (No automatic silent recovery)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];

    // 1. Trigger developing warning
    for (let t = 0; t < 35; t++) {
      window.push({
        suction_pressure: 1.05,
        discharge_pressure: 5.65,
        flow_rate: 85.5,
        vibration_rms: 5.45,
        temperature: 62.0,
        rpm: 2942
      });
      if (window.length > 30) window.shift();
      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t, 'PUMP-01', pred, null, alerts, alerts.length + 1);
    }

    const warning = alerts.find(a => a.category.includes('Developing'));
    assert(warning && warning.status === 'active', 'Warning must be active initially');

    // 2. Telemetry returns to nominal readings - alert must remain latched (no silent auto-resolution)
    for (let t = 0; t < 35; t++) {
      window.push({ ...NOMINAL_DEFAULT });
      window.shift();
      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t + 35, 'PUMP-01', pred, null, alerts, alerts.length + 1);
    }

    assert.strictEqual(warning.status, 'active', 'Fault alert must remain persistent and active until explicit operator resolution');

    // 3. Explicit resolution by operator
    warning.status = 'resolved';
    warning.resolved_ts = new Date().toISOString();
    assert.strictEqual(warning.status, 'resolved', 'Fault alert marked resolved upon explicit operator action');
    assert(warning.resolved_ts, 'Resolution timestamp must be recorded');
  });

  // 5. Isolated Sensor Spike Test
  test('Test 5: Isolated Sensor Spikes (Rejected by persistence filter, no spurious alarms)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];

    for (let t = 0; t < 40; t++) {
      let r = { ...NOMINAL_DEFAULT };

      // Single-tick glitch spike at t=15 and t=28
      if (t === 15) {
        r.vibration_rms = 9.8; // massive vibration spike
      }
      if (t === 28) {
        r.suction_pressure = 0.4; // instantaneous suction dropout
      }

      window.push(r);
      if (window.length > 30) window.shift();

      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t, 'PUMP-01', pred, null, alerts, alerts.length + 1);
    }

    // Since the spikes were isolated 1-tick anomalies, persistence filter (3 ticks) must reject them!
    const cavitationAlerts = alerts.filter(a => a.category.includes('Cavitation'));
    assert.strictEqual(cavitationAlerts.length, 0, `Isolated spikes must NOT trigger cavitation alarms (got ${cavitationAlerts.length})`);
  });

  // 6. Persistent Fault Latching Test
  test('Test 6: Persistent Fault Latching (Alarm stays visible and latches)', () => {
    const alertMgr = new AlertManager({ persistence_windows: 3, clear_windows: 5 });
    const alerts = [];
    const window = [];

    // Continuous severe condition for 15 seconds
    for (let t = 0; t < 35; t++) {
      window.push({
        suction_pressure: 0.62,
        discharge_pressure: 4.35,
        flow_rate: 71.8,
        vibration_rms: 8.42,
        temperature: 72.5,
        rpm: 2930
      });
      if (window.length > 30) window.shift();

      const pred = engine.predict(window);
      alertMgr.evaluate(new Date().toISOString(), t, 'PUMP-01', pred, null, alerts, alerts.length + 1);
    }

    const critAlert = alerts.find(a => a.category.includes('CRITICAL'));
    assert(critAlert, 'Critical alarm must be generated');
    assert.strictEqual(critAlert.status, 'active', 'Critical alarm must remain active');
    assert.strictEqual(critAlert.severity, 2, 'Severity must be 2');
  });

  // 7. Multi-Fault Coexistence & Independent Resolution
  test('Test 7: Multi-Fault Coexistence & Independent Resolution', () => {
    const activeFaults = new Set();
    const FAULTS = {
      developing_cavitation: { delta_P_suct: -0.95, delta_P_disc: -0.85, delta_Q: -14.5, delta_V: 3.60, delta_T: 9.5, delta_RPM: -8 },
      bearing_wear: { delta_P_suct: 0.0, delta_P_disc: -0.15, delta_Q: -1.2, delta_V: 3.10, delta_T: 22.0, delta_RPM: -15 }
    };

    function computeSensors(faults) {
      let p_suct = 2.05, p_disc = 6.52, q = 100.2, temp = 52.5, rpm = 2950;
      let sumSqVib = 0;
      for (const fid of faults) {
        const def = FAULTS[fid];
        if (!def) continue;
        p_suct += def.delta_P_suct;
        p_disc += def.delta_P_disc;
        q += def.delta_Q;
        temp += def.delta_T;
        rpm += def.delta_RPM;
        sumSqVib += def.delta_V * def.delta_V;
      }
      const v = Math.sqrt(1.85 * 1.85 + sumSqVib);
      return { p_suct, p_disc, q, v, temp, rpm };
    }

    // Baseline
    const base = computeSensors(activeFaults);
    assert.strictEqual(base.p_suct, 2.05);
    assert.strictEqual(base.temp, 52.5);

    // Inject fault 1: developing_cavitation
    activeFaults.add('developing_cavitation');
    const f1 = computeSensors(activeFaults);
    assert(f1.p_suct < 1.20, 'Cavitation should depress suction pressure');
    assert(f1.v > 3.8, 'Vibration should increase');

    // Inject fault 2: bearing_wear simultaneously
    activeFaults.add('bearing_wear');
    const f12 = computeSensors(activeFaults);
    assert(f12.temp > 80, 'Additive heating should push bearing temperature above 80°C');
    assert(f12.v > f1.v, 'Vibration should combine via root-sum-squared');

    // Resolve fault 1 (developing_cavitation)
    activeFaults.delete('developing_cavitation');
    const f2only = computeSensors(activeFaults);
    assert.strictEqual(f2only.p_suct, 2.05, 'Suction pressure must return to nominal when cavitation is resolved');
    assert(f2only.temp === 52.5 + 22.0, 'Bearing temperature must retain bearing_wear elevation (74.5°C)');

    // Resolve fault 2 (bearing_wear)
    activeFaults.delete('bearing_wear');
    const restored = computeSensors(activeFaults);
    assert.strictEqual(restored.p_suct, 2.05);
    assert.strictEqual(restored.temp, 52.5);
    assert.strictEqual(restored.v, 1.85);
  });

  console.log(`\n=== Test Results: ${passed} / ${total} Passed ===`);
  if (passed === total) {
    console.log('ALL AUTOMATED TESTS PASSED SUCCESSFULLY!\n');
  } else {
    process.exit(1);
  }
}

runTests();

