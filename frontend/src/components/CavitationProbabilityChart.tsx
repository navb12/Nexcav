import React from 'react';
import { PredictionHistoryItem } from '../types.ts';

interface CavitationProbabilityChartProps {
  currentProbability: number;
  history?: PredictionHistoryItem[];
  faultSeverityPercent?: number;
  faultActive?: boolean;
}

export const CavitationProbabilityChart: React.FC<CavitationProbabilityChartProps> = ({
  currentProbability = 0.0,
  history = []
}) => {
  // SVG coordinates:
  const plotLeft = 55;
  const plotRight = 550;
  const plotTop = 50;
  const plotBottom = 250;
  const plotWidth = plotRight - plotLeft; // 495
  const plotHeight = plotBottom - plotTop; // 200

  // Y-axis levels
  const y100 = plotTop; // 50
  const y50 = plotTop + plotHeight * 0.5; // 150 (50% decision boundary)
  const y0 = plotBottom; // 250

  // 30-sample rolling timeline window
  const maxWindow = 30;
  const recentHistory = (history || []).slice(-maxWindow);

  // Map ONLY real points from history
  const points: { x: number; y: number; p: number; sim_t: number; vib?: number; idx: number }[] = [];

  if (recentHistory.length > 0) {
    recentHistory.forEach((item, idx) => {
      const p = Math.max(0, Math.min(1, item.probability ?? item.model_score ?? 0));
      // X coordinates spread across the 30-second viewport
      const x = plotLeft + (idx / (maxWindow - 1)) * plotWidth;
      const y = plotBottom - p * plotHeight;
      points.push({
        x,
        y,
        p,
        sim_t: item.sim_t,
        vib: item.vibration_rms,
        idx
      });
    });
  }

  // Generate SVG curve strictly from real points
  let pathD = '';
  if (points.length === 1) {
    pathD = `M ${points[0].x} ${points[0].y} L ${points[0].x + 1} ${points[0].y}`;
  } else if (points.length > 1) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev.x + curr.x) / 2;
      pathD += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
    }
  }

  // --- Real Dynamic Event Detection (NO FAKE / HARDCODED NUMBERS) ---
  // 1. Detect when ML probability actually crossed >= 50%
  const mlCrossIndex = points.findIndex(pt => pt.p >= 0.50);
  const mlCrossPoint = mlCrossIndex >= 0 ? points[mlCrossIndex] : null;

  // 2. Detect when baseline vibration actually crossed standard alarm threshold (4.5 mm/s)
  const baselineCrossIndex = points.findIndex(pt => pt.vib !== undefined && pt.vib >= 4.5);
  const baselineCrossPoint = baselineCrossIndex >= 0 ? points[baselineCrossIndex] : null;

  // 3. Compute real lead time IF AND ONLY IF both have occurred in current window
  let dynamicLeadTime: number | null = null;
  if (mlCrossPoint && baselineCrossPoint) {
    dynamicLeadTime = +(baselineCrossPoint.sim_t - mlCrossPoint.sim_t).toFixed(1);
  }

  // Format second to mm:ss
  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      userSelect: 'none'
    }}>
      {/* Chart Top Header & Legend */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '2px 8px 6px',
        borderBottom: '1px solid #1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.2px' }}>
            Cavitation probability
          </span>
          <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
            (Live P = {Math.round(currentProbability * 100)} %)
          </span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
            <span style={{ display: 'inline-block', width: '16px', height: '2.5px', backgroundColor: '#60a5fa', borderRadius: '1px' }} />
            <span>ML model</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
            <span style={{ display: 'inline-block', width: '16px', height: '0px', borderTop: '2px dashed #94a3b8' }} />
            <span>Threshold alarm (vibration)</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas Chart */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', width: '100%' }}>
        <svg
          viewBox="0 0 600 300"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
          preserveAspectRatio="none"
        >
          {/* Y-Axis Grid Lines & Labels */}
          {/* 100% */}
          <line x1={plotLeft} y1={y100} x2={plotRight} y2={y100} stroke="#1e293b" strokeWidth="1" />
          <text x={plotLeft - 12} y={y100 + 4} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="end">
            100
          </text>

          {/* 50% Threshold Dashed Line */}
          <line
            x1={plotLeft}
            y1={y50}
            x2={plotRight}
            y2={y50}
            stroke="#94a3b8"
            strokeWidth="1.4"
            strokeDasharray="5 5"
          />
          <text x={plotLeft - 12} y={y50 + 4} fill="#94a3b8" fontSize="11" fontFamily="monospace" textAnchor="end">
            50
          </text>
          <text
            x={plotRight - 10}
            y={y50 - 8}
            fill="#cbd5e1"
            fontSize="12"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            fontWeight="500"
            textAnchor="end"
          >
            threshold 50 %
          </text>

          {/* 0% Baseline */}
          <line x1={plotLeft} y1={y0} x2={plotRight} y2={y0} stroke="#334155" strokeWidth="1.2" />
          <text x={plotLeft - 12} y={y0 + 4} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="end">
            0
          </text>

          {/* X-Axis Ticks & Labels (0, 10, 20, 30 s) */}
          <text x={plotLeft} y={plotBottom + 20} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="middle">
            0
          </text>
          <text x={plotLeft + (10 / 30) * plotWidth} y={plotBottom + 20} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="middle">
            10
          </text>
          <text x={plotLeft + (20 / 30) * plotWidth} y={plotBottom + 20} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="middle">
            20
          </text>
          <text x={plotRight} y={plotBottom + 20} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="end">
            30 s
          </text>

          {/* Real ML Probability Curve (Plotted from real model history) */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="3.0"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Real ML Crossing Flag (Only shown when actual probability crosses 50%) */}
          {mlCrossPoint && (
            <g>
              <circle
                cx={mlCrossPoint.x}
                cy={y50}
                r="5"
                fill="#60a5fa"
                stroke="#ffffff"
                strokeWidth="1.8"
              />
              <text
                x={mlCrossPoint.x + 8}
                y={y50 + 16}
                fill="#93c5fd"
                fontSize="11.5"
                fontWeight="600"
                fontFamily="monospace"
              >
                ML flag {formatTime(mlCrossPoint.sim_t)}
              </text>
            </g>
          )}

          {/* Real Baseline Alarm Flag (Only shown when vibration actually crosses 4.5 mm/s) */}
          {baselineCrossPoint && (
            <g>
              <line
                x1={baselineCrossPoint.x}
                y1={y50}
                x2={baselineCrossPoint.x}
                y2={plotBottom}
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <circle
                cx={baselineCrossPoint.x}
                cy={y50}
                r="4.5"
                fill="#94a3b8"
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <text
                x={baselineCrossPoint.x}
                y={plotBottom - 18}
                fill="#94a3b8"
                fontSize="11"
                fontFamily="monospace"
                textAnchor="end"
              >
                Baseline alarm {formatTime(baselineCrossPoint.sim_t)}
              </text>
            </g>
          )}

          {/* Real Calculated Lead-Time Dimension Bracket (Only shown when BOTH have actually occurred) */}
          {mlCrossPoint && baselineCrossPoint && dynamicLeadTime !== null && (
            <g transform={`translate(${Math.min(mlCrossPoint.x, baselineCrossPoint.x)}, ${y50 + 38})`}>
              {/* Horizontal bar spanning actual distance */}
              <line
                x1="0"
                y1="0"
                x2={Math.abs(baselineCrossPoint.x - mlCrossPoint.x)}
                y2="0"
                stroke="#cbd5e1"
                strokeWidth="1.4"
              />
              {/* Left bracket tick */}
              <line x1="0" y1="-5" x2="0" y2="5" stroke="#cbd5e1" strokeWidth="1.4" />
              {/* Right bracket tick */}
              <line
                x1={Math.abs(baselineCrossPoint.x - mlCrossPoint.x)}
                y1="-5"
                x2={Math.abs(baselineCrossPoint.x - mlCrossPoint.x)}
                y2="5"
                stroke="#cbd5e1"
                strokeWidth="1.4"
              />
              {/* Actual calculated lead-time label */}
              <text
                x={Math.abs(baselineCrossPoint.x - mlCrossPoint.x) / 2}
                y="-8"
                fill="#f1f5f9"
                fontSize="12.5"
                fontWeight="700"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {dynamicLeadTime > 0 ? `${dynamicLeadTime} s earlier` : `${Math.abs(dynamicLeadTime)} s later`}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
