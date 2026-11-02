import React, { useEffect, useState } from 'react';
import { DataOverview, DataOverviewPlotPoint } from '../types.ts';

export const DataMethodPanel: React.FC = () => {
  const [dataOverview, setDataOverview] = useState<DataOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/data/overview')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: DataOverview) => {
        if (active) {
          setDataOverview(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Helper to render mini SVG line chart for run comparison
  const renderMiniPlot = (pts: DataOverviewPlotPoint[], color: string, title: string, subtitle: string) => {
    if (!pts || pts.length === 0) return null;
    const maxT = Math.max(...pts.map(p => p.t)) || 30;
    const maxVib = Math.max(5.0, ...pts.map(p => p.vib));
    const minVib = 0;

    const pathD = pts.map((p, i) => {
      const x = 35 + (p.t / maxT) * 220;
      const y = 95 - ((p.vib - minVib) / (maxVib - minVib)) * 75;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

    return (
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc' }}>{title}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>{subtitle}</div>
          </div>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', color }}>
            Vib RMS peak: {Math.max(...pts.map(p => p.vib)).toFixed(2)} mm/s
          </div>
        </div>
        <div style={{ width: '100%', height: '110px' }}>
          <svg viewBox="0 0 270 110" style={{ width: '100%', height: '100%' }}>
            {/* Grid & baseline */}
            <line x1="35" y1="95" x2="260" y2="95" stroke="#334155" strokeWidth="1" />
            <line x1="35" y1="20" x2="35" y2="95" stroke="#334155" strokeWidth="1" />
            {/* 4.5 mm/s alarm threshold line */}
            <line
              x1="35"
              y1={95 - (4.5 / maxVib) * 75}
              x2="260"
              y2={95 - (4.5 / maxVib) * 75}
              stroke="#ef4444"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text x="258" y={95 - (4.5 / maxVib) * 75 - 3} fill="#ef4444" fontSize="8" fontFamily="monospace" textAnchor="end">
              4.5 mm/s alarm
            </text>
            <path d={pathD} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
            <text x="30" y="98" fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">0</text>
            <text x="30" y="24" fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">{maxVib.toFixed(0)}</text>
            <text x="35" y="106" fill="#64748b" fontSize="8.5" fontFamily="monospace">0s</text>
            <text x="260" y="106" fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">{maxT}s</text>
          </svg>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
        Loading real dataset overview and model specification...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: '#ef4444', fontSize: '13px' }}>
        Failed to load dataset overview: {error}
      </div>
    );
  }

  const split = dataOverview?.metrics?.split_sizes || { train_runs: 80, test_runs: 20, train_samples: 4800, test_samples: 1200 };
  const totalRuns = split.train_runs + split.test_runs;
  const totalRows = split.train_samples + split.test_samples;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px', margin: '0 auto', color: '#cbd5e1' }}>
      {/* 1. Problem Statement & Why Cavitation Matters */}
      <div style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '8px',
        padding: '16px 20px'
      }}>
        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px', color: '#38bdf8', fontWeight: 700, marginBottom: '6px' }}>
          Problem Statement & Industrial Motivation
        </div>
        <p style={{ margin: '0 0 8px 0', fontSize: '14px', lineHeight: '1.6', color: '#f8fafc', fontWeight: 500 }}>
          Pump cavitation occurs when localized suction pressure falls below fluid vapor pressure, creating vapor cavities that implode against impeller vanes. Early automated detection flags hydrodynamic breakdown seconds before destructive shockwaves occur, preventing catastrophic impeller pitting, seal failure, and unplanned plant shutdown.
        </p>
      </div>

      {/* 2. Dataset Synthesis & Train/Test Split by Run */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px'
      }}>
        {/* Dataset Specifications */}
        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 10px 0' }}>
            Dataset Generation & Physics Synthesis
          </h3>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: '1.7', color: '#94a3b8' }}>
            <li><strong style={{ color: '#cbd5e1' }}>Total Runs:</strong> {totalRuns} independent operational runs ({totalRows.toLocaleString()} total rows)</li>
            <li><strong style={{ color: '#cbd5e1' }}>Sampling Cadence:</strong> 1.0 second per telemetry sample (60 seconds per run)</li>
            <li><strong style={{ color: '#cbd5e1' }}>Class Balance:</strong> ~58% Normal Operation, ~42% Cavitation (Incipient, Developed, Severe)</li>
            <li><strong style={{ color: '#cbd5e1' }}>Industrial Noise & Borderline Cases:</strong> Includes dynamic turbulence fluctuations, intermittent sub-threshold NPSH dips, and a reproducible pseudorandom seed (seed=42).</li>
          </ul>
        </div>

        {/* Partition Isolation */}
        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 10px 0' }}>
            Train / Test Split (Grouped by Run ID)
          </h3>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: '1.7', color: '#94a3b8' }}>
            <li><strong style={{ color: '#cbd5e1' }}>Training Split:</strong> {split.train_runs} runs ({split.train_samples.toLocaleString()} rows &bull; 80%) &rarr; <code>data/nexcav_train.csv</code></li>
            <li><strong style={{ color: '#cbd5e1' }}>Test Holdout:</strong> {split.test_runs} runs ({split.test_samples.toLocaleString()} rows &bull; 20%) &rarr; <code>data/test_runs.csv</code></li>
            <li style={{ color: '#38bdf8', marginTop: '6px' }}>
              <strong>Strict Run Boundary Guarantee:</strong> Runs are grouped strictly by <code>run_id</code>. Zero test runs or subsequent time slices were ever shared with the training set.
            </li>
          </ul>
        </div>
      </div>

      {/* 3. Sensor Dynamics in Cavitation Table */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 12px 0' }}>
          Physical Telemetry Sensors & Cavitation Response
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ padding: '8px' }}>Sensor</th>
                <th style={{ padding: '8px' }}>Unit</th>
                <th style={{ padding: '8px' }}>Nominal</th>
                <th style={{ padding: '8px' }}>Behavior in Cavitation</th>
                <th style={{ padding: '8px' }}>Physical Hydrodynamic Cause</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Suction pressure</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>bar</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>2.00</td>
                <td style={{ padding: '8px', color: '#f87171' }}>Drops significantly (&lt; 0.6 bar)</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Inlet restriction / low NPSHa below fluid vapor pressure</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Discharge pressure</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>bar</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>6.50</td>
                <td style={{ padding: '8px', color: '#f87171' }}>Degrades with instability</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Vapor bubble blockage reduces impeller head generation</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Flow rate</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>m³/h</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>100.0</td>
                <td style={{ padding: '8px', color: '#f87171' }}>Drops (choked flow)</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Vapor pockets constrict effective impeller eye throat area</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Vibration RMS</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>mm/s</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>1.85</td>
                <td style={{ padding: '8px', color: '#f59e0b' }}>Spikes sharply (&gt; 4.5 mm/s)</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Micro-jet shockwave energy from imploding vapor bubbles</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Motor current</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>A</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>11.8</td>
                <td style={{ padding: '8px', color: '#38bdf8' }}>Fluctuates / drops with flow</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Loss of fluid mass reduces motor shaft load resistance</td>
              </tr>
              <tr>
                <td style={{ padding: '8px', fontWeight: 600, color: '#f8fafc' }}>Temperature</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>°C</td>
                <td style={{ padding: '8px', fontFamily: 'monospace' }}>52.0</td>
                <td style={{ padding: '8px', color: '#fb923c' }}>Mild progressive climb</td>
                <td style={{ padding: '8px', color: '#94a3b8' }}>Turbulent energy dissipation & localized recirculation heating</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Features & Model Selection */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 10px 0' }}>
          Feature Engineering & Classifier Architecture
        </h3>
        <div style={{ fontSize: '12.5px', lineHeight: '1.7', color: '#94a3b8' }}>
          <div>
            <strong style={{ color: '#cbd5e1' }}>Rolling-Window Features:</strong> Computed strictly within individual run boundaries over a 10-second rolling window:
            mean, standard deviation, and maximum per telemetry channel, plus cross-sensor ratios (<code>head_diff</code>, <code>vib_to_flow</code>).
          </div>
          <div style={{ marginTop: '6px' }}>
            <strong style={{ color: '#cbd5e1' }}>Model Choice:</strong> <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>RandomForestClassifier</span> (100 estimators) &mdash; Chosen because tree ensembles provide robust non-linear separation on multi-sensor interactions and remain invariant to monotonic feature scaling while demonstrating resilience against industrial sensor noise.
          </div>
        </div>
      </div>

      {/* 5. Two Small Plots (Healthy Run vs Cavitation Run) */}
      <div>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 10px 0' }}>
          Exemplar Holdout Runs (Test Data Profiles)
        </h3>
        <div style={{ display: 'flex', gap: '16px' }}>
          {renderMiniPlot(
            dataOverview?.plots?.healthy || [],
            '#34d399',
            'Healthy Nominal Run (run_004_normal)',
            'Stable vibration below baseline alarm, consistent suction pressure'
          )}
          {renderMiniPlot(
            dataOverview?.plots?.cavitation || [],
            '#ef4444',
            'Cavitation Inception Run (run_005_developed)',
            'Sharp rise in vibration RMS breaching 4.5 mm/s alarm after suction restriction'
          )}
        </div>
      </div>

      {/* 6. First 10 Rows of CSV */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
            Raw Telemetry Sample (First 10 Rows of <code>data/test_runs.csv</code>)
          </h3>
          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
            Showing 10 of {split.test_samples.toLocaleString()} test rows
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'monospace', textAlign: 'right' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ padding: '6px', textAlign: 'left' }}>run_id</th>
                <th style={{ padding: '6px' }}>time_s</th>
                <th style={{ padding: '6px' }}>suction_p</th>
                <th style={{ padding: '6px' }}>discharge_p</th>
                <th style={{ padding: '6px' }}>flow</th>
                <th style={{ padding: '6px' }}>vib_rms</th>
                <th style={{ padding: '6px' }}>temp</th>
                <th style={{ padding: '6px' }}>rpm</th>
                <th style={{ padding: '6px' }}>sev_%</th>
                <th style={{ padding: '6px' }}>label</th>
              </tr>
            </thead>
            <tbody>
              {(dataOverview?.first_10_rows || []).map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '6px', textAlign: 'left', color: '#f8fafc' }}>{row.run_id}</td>
                  <td style={{ padding: '6px', color: '#94a3b8' }}>{row.time_s}</td>
                  <td style={{ padding: '6px', color: '#38bdf8' }}>{row.suction_pressure}</td>
                  <td style={{ padding: '6px' }}>{row.discharge_pressure}</td>
                  <td style={{ padding: '6px' }}>{row.flow_rate}</td>
                  <td style={{ padding: '6px', color: '#f59e0b' }}>{row.vibration_rms}</td>
                  <td style={{ padding: '6px' }}>{row.temperature}</td>
                  <td style={{ padding: '6px' }}>{row.rpm}</td>
                  <td style={{ padding: '6px' }}>{row.severity_pct}</td>
                  <td style={{ padding: '6px', color: row.label === '1' ? '#ef4444' : '#34d399', fontWeight: 700 }}>
                    {row.label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. Operator Feedback Summary (from data/feedback_log.csv) */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
              Operator Feedback & Model Governance (data/feedback_log.csv)
            </h3>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Real-time audit log of operator review verdicts on early warning and cavitation alerts
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
            Append-only feedback log
          </span>
        </div>

        {/* Feedback KPI Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '10px',
          marginBottom: '14px'
        }}>
          <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase' }}>Alerts Raised</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace', marginTop: '3px' }}>
              {dataOverview?.feedback_summary?.total_alerts ?? 0}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>Total logged events</div>
          </div>

          <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase' }}>Confirmed Correct</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace', marginTop: '3px' }}>
              {dataOverview?.feedback_summary?.correct ?? 0}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>Verified cavitation</div>
          </div>

          <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase' }}>False Alarms</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171', fontFamily: 'monospace', marginTop: '3px' }}>
              {dataOverview?.feedback_summary?.false_alarms ?? 0}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>Rejected by operator</div>
          </div>

          <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase' }}>Unreviewed</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace', marginTop: '3px' }}>
              {dataOverview?.feedback_summary?.unreviewed ?? 0}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>Pending review</div>
          </div>

          <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase' }}>False Alarm Rate</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: (dataOverview?.feedback_summary?.false_alarm_rate ?? 0) > 10 ? '#f87171' : '#38bdf8', fontFamily: 'monospace', marginTop: '3px' }}>
              {dataOverview?.feedback_summary?.false_alarm_rate ?? 0}%
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>FA / Reviewed alerts</div>
          </div>
        </div>

        {/* Recent Feedback Entries Table */}
        {(dataOverview?.feedback_summary?.recent_entries || []).length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'monospace', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                  <th style={{ padding: '5px' }}>alert_id</th>
                  <th style={{ padding: '5px' }}>level</th>
                  <th style={{ padding: '5px' }}>mode</th>
                  <th style={{ padding: '5px' }}>prob</th>
                  <th style={{ padding: '5px' }}>suct_p</th>
                  <th style={{ padding: '5px' }}>vib_rms</th>
                  <th style={{ padding: '5px' }}>verdict</th>
                </tr>
              </thead>
              <tbody>
                {(dataOverview?.feedback_summary?.recent_entries || []).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '5px', color: '#cbd5e1' }}>{row.alert_id}</td>
                    <td style={{ padding: '5px', color: row.alert_level === 'predicted' ? '#ef4444' : '#f59e0b' }}>{row.alert_level}</td>
                    <td style={{ padding: '5px', color: '#94a3b8' }}>{row.mode}</td>
                    <td style={{ padding: '5px', color: '#38bdf8' }}>{row.probability}</td>
                    <td style={{ padding: '5px' }}>{row.suction_pressure} bar</td>
                    <td style={{ padding: '5px' }}>{row.vibration_rms} mm/s</td>
                    <td style={{
                      padding: '5px',
                      fontWeight: 700,
                      color: row.verdict === 'correct' ? '#34d399' : row.verdict === 'false_alarm' ? '#f87171' : '#f59e0b'
                    }}>
                      {row.verdict}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 8. Limitations */}
      <div style={{
        backgroundColor: '#111827',
        border: '1px solid #334155',
        borderRadius: '8px',
        padding: '14px 18px',
        fontSize: '12px',
        color: '#94a3b8'
      }}>
        <strong style={{ color: '#f59e0b' }}>System Limitations & Future Scope:</strong> Telemetry was synthesized from industrial hydrodynamic equations with synthetic Gaussian noise and turbulence bursts. Production deployment requires fine-tuning on high-frequency piezoelectric accelerometer spectra and distributed DCS telemetry across physical industrial pump skids.
      </div>
    </div>
  );
};
