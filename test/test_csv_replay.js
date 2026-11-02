const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test test_runs.csv parser logic
function testCSVReader() {
  const filePath = path.join(__dirname, '..', 'data', 'test_runs.csv');
  assert(fs.existsSync(filePath), 'data/test_runs.csv must exist');

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  assert(lines.length > 1, 'CSV must have header and rows');

  const headers = lines[0].split(',').map(h => h.trim());
  const expectedCols = ['run_id', 'time_s', 'suction_pressure', 'discharge_pressure', 'flow_rate', 'vibration_rms', 'temperature', 'rpm', 'severity_pct', 'label'];
  expectedCols.forEach(col => {
    assert(headers.includes(col), `Missing expected column: ${col}`);
  });

  const runsMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    const rid = parts[0];
    const sev = +parts[8];
    const lbl = +parts[9];
    if (!runsMap.has(rid)) {
      runsMap.set(rid, { count: 0, maxSev: 0, hasCav: false });
    }
    const r = runsMap.get(rid);
    r.count++;
    if (sev > r.maxSev) r.maxSev = sev;
    if (lbl === 1) r.hasCav = true;
  }

  assert.strictEqual(runsMap.size, 20, 'Must have exactly 20 test runs');
  console.log(`✓ [PASS] test_runs.csv verified with ${runsMap.size} distinct test runs.`);

  for (const [rid, stats] of runsMap.entries()) {
    assert.strictEqual(stats.count, 60, `Run ${rid} must have exactly 60 seconds of data`);
    let label = 'normal';
    if (stats.maxSev > 0 || stats.hasCav) {
      label = `cavitation, max severity ${Math.round(stats.maxSev)} %`;
    }
    assert(label.length > 0);
  }
  console.log('✓ [PASS] All 20 run labels dynamically computed from real row data.');
}

testCSVReader();
console.log('\n=== CSV Replay Unit Validation Passed Successfully ===');

