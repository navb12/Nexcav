/**
 * NexCav All-in-One Service Launcher
 * Starts both:
 * 1. Python ML Microservice (FastAPI + model.pkl on port 5001)
 * 2. Node.js Monitoring Server (Simulation + WebSockets on port 8000)
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('=======================================================');
console.log('  NEXCAV Full-Stack System Launcher');
console.log('  1. Python ML Inference Service (FastAPI -> port 5001)');
console.log('  2. Node.js Telemetry & WebSocket Engine (port 8000)');
console.log('=======================================================\n');

// 1. Spawn Python ML Service
console.log('[Launcher] Starting Python ML Inference Service (ml/serve.py)...');
const pyProc = spawn('python', ['ml/serve.py'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

pyProc.on('error', (err) => {
  console.error('[Launcher] Failed to start Python process:', err.message);
});

// Give Python service 1.5s to bind port 5001
setTimeout(() => {
  // 2. Start Node.js Primary Server
  console.log('[Launcher] Starting Node.js SCADA Server (server.js)...');
  const nodeProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });

  nodeProc.on('error', (err) => {
    console.error('[Launcher] Failed to start Node server:', err.message);
  });

  const cleanup = () => {
    console.log('\n[Launcher] Shutting down services...');
    try { pyProc.kill(); } catch (e) {}
    try { nodeProc.kill(); } catch (e) {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}, 1500);

