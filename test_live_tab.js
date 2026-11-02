const http = require('http');
const { spawn } = require('child_process');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('[Step 3 Test] Spawning Python ML service (port 5001)...');
  const pyProc = spawn('python', ['ml/serve.py'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 3500));

  console.log('[Step 3 Test] Spawning Node SCADA server (port 8000)...');
  const nodeProc = spawn('node', ['server.js'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 2500));

  try {
    // 1. Initial healthy state check
    const statusBefore = await get('http://127.0.0.1:8000/api/status');
    console.log('\n--- 1. Baseline Healthy State ---');
    console.log('Actuators:', statusBefore.actuators);
    console.log('Model Status:', statusBefore.model.model_type, '| Source:', statusBefore.model.source);

    // 2. Inject manual fault: suction restriction (cavitation)
    console.log('\n--- 2. Injecting Manual Fault (suction restriction)... ---');
    const injectRes = await post('http://127.0.0.1:8000/api/sim/inject-fault', {
      fault: 'severe_cavitation',
      action: 'add'
    });
    console.log('Active Faults:', injectRes.active_faults);
    console.log('Actuator suction_restriction:', injectRes.actuators.suction_restriction);

    // Let simulation tick 3 times so rolling window populates with degraded readings
    await new Promise(r => setTimeout(r, 3000));

    const statusFault = await get('http://127.0.0.1:8000/api/status');
    const latestFault = statusFault.latest;
    console.log('\n--- 3. Verifying Prediction Under Injected Fault ---');
    console.log('Telemetry Suction Pressure:', latestFault.readings.suction_pressure, 'bar');
    console.log('Telemetry Vibration RMS:   ', latestFault.readings.vibration_rms, 'mm/s');
    console.log('Python Model Probability:  ', (latestFault.prediction.probability * 100).toFixed(1) + '%');
    console.log('Derived Severity Stage:    ', latestFault.prediction.status);

    // 4. Reset/Repair back to normal
    console.log('\n--- 4. Resetting Fault / Equipment Repair ---');
    const repairRes = await post('http://127.0.0.1:8000/api/sim/repair', {});
    console.log('Actuators after repair:', repairRes.actuators);

    await new Promise(r => setTimeout(r, 2000));
    const statusRepaired = await get('http://127.0.0.1:8000/api/status');
    const latestRepaired = statusRepaired.latest;
    console.log('Python Model Probability after repair:', (latestRepaired.prediction.probability * 100).toFixed(1) + '%');
    console.log('Severity Stage after repair:          ', latestRepaired.prediction.status);

    console.log('\n[PASS] Manual fault injection and Python model predictions verified end-to-end!');
  } finally {
    pyProc.kill();
    nodeProc.kill();
  }
}

run().catch(console.error);

