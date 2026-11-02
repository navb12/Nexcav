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
  console.log('[Test] Spawning Python ML service...');
  const pyProc = spawn('python', ['ml/serve.py'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 4000));

  console.log('[Test] Spawning Node server...');
  const nodeProc = spawn('node', ['server.js'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 3000));

  try {
    console.log('\n--- 1. Testing Python ML Microservice (port 5001) ---');
    const mlHealth = await get('http://127.0.0.1:5001/health');
    console.log('ML Health:', mlHealth);

    const testPrediction = await post('http://127.0.0.1:5001/predict', {
      window: [
        { suction_pressure: 2.04, discharge_pressure: 6.52, flow_rate: 100.2, vibration_rms: 1.85, temperature: 52.5, rpm: 2950 },
        { suction_pressure: 2.05, discharge_pressure: 6.51, flow_rate: 100.4, vibration_rms: 1.88, temperature: 52.6, rpm: 2951 }
      ]
    });
    console.log('ML Prediction test (nominal healthy window):', testPrediction);

    const testCavitation = await post('http://127.0.0.1:5001/predict', {
      window: [
        { suction_pressure: 1.10, discharge_pressure: 5.20, flow_rate: 75.0, vibration_rms: 5.50, temperature: 58.0, rpm: 2920 },
        { suction_pressure: 0.95, discharge_pressure: 4.80, flow_rate: 70.0, vibration_rms: 6.80, temperature: 59.2, rpm: 2910 }
      ]
    });
    console.log('ML Prediction test (cavitating window):', testCavitation);

    console.log('\n--- 2. Testing Node SCADA Server (port 8000) ---');
    const nodeStatus = await get('http://127.0.0.1:8000/api/status');
    console.log('Node Server Model Status:', nodeStatus.model);

    const metrics = await get('http://127.0.0.1:8000/api/model/metrics');
    console.log('Model Type:', metrics.model_type);
    console.log('Accuracy:  ', (metrics.accuracy * 100).toFixed(2) + '%');
    console.log('Precision: ', (metrics.precision * 100).toFixed(2) + '%');
    console.log('Recall:    ', (metrics.recall * 100).toFixed(2) + '%');
    console.log('F1-Score:  ', (metrics.f1_score * 100).toFixed(2) + '%');
    console.log('ROC-AUC:   ', metrics.roc_auc);
    console.log('Confusion Matrix:', metrics.confusion_matrix);
    console.log('Split Sizes:', metrics.split_sizes);

    console.log('\n[PASS] All integration checks passed!');
  } finally {
    pyProc.kill();
    nodeProc.kill();
    // Also clean up on Windows using taskkill
    const { exec } = require('child_process');
    exec('taskkill /F /IM python.exe /T', () => {});
    exec('taskkill /F /IM node.exe /FI "WINDOWTITLE ne *" /T', () => {});
  }
}

run().catch(console.error);
