import React, { useEffect, useRef, useMemo } from 'react';
import { PredictionHistoryItem } from '../types.ts';

// Named constant for Exponential Moving Average smoothing of plotted line
export const EMA_ALPHA = 0.3;
export const WARN_PROB = 0.25;
export const DETECT_PROB = 0.50;

export const CORRECTIVE_ACTIONS: Record<string, string> = {
  suction_restriction: 'Open suction valve, clear strainer, check suction line',
  discharge_throttling: 'Open discharge valve to restore flow',
  bearing_wear: 'Schedule bearing inspection (this is not cavitation)',
  vibration_unbalance: 'Check rotor alignment and balance'
};

interface CavitationProbabilityChartProps {
  currentProbability: number;
  history?: PredictionHistoryItem[];
  faultSeverityPercent?: number;
  faultActive?: boolean;
  activeFaultType?: string;
  correctiveAction?: string;
}

export const CavitationProbabilityChart: React.FC<CavitationProbabilityChartProps> = ({
  currentProbability = 0.0,
  history = [],
  faultSeverityPercent = 0,
  activeFaultType = 'suction_restriction',
  correctiveAction
}) => {
  // SVG coordinates (Fixed axes):
  const plotLeft = 55;
  const plotRight = 550;
  const plotTop = 50;
  const plotBottom = 250;
  const plotWidth = plotRight - plotLeft; // 495
  const plotHeight = plotBottom - plotTop; // 200

  // Y-axis levels (Fixed 0 to 100%)
  const y100 = plotTop; // 50
  const y50 = plotTop + plotHeight * 0.5; // 150 (50% decision boundary)
  const y0 = plotBottom; // 250

  // Rolling 30-sample window
  const maxWindow = 30;
  const recentHistory = useMemo(() => (history || []).slice(-maxWindow), [history]);

  // Compute EMA-smoothed values for the plotted line while preserving raw values in the data
  const processedPoints = useMemo(() => {
    if (recentHistory.length === 0) return [];

    let ema: number | null = null;
    return recentHistory.map((item, idx) => {
      const rawP = Math.max(0, Math.min(1, item.probability ?? item.model_score ?? 0));
      if (ema === null) {
        ema = rawP;
      } else {
        ema = EMA_ALPHA * rawP + (1 - EMA_ALPHA) * ema;
      }

      // Fixed 30s rolling horizontal window
      const x = recentHistory.length === 1
        ? plotLeft
        : plotLeft + (idx / (maxWindow - 1)) * plotWidth;
      const targetY = plotBottom - ema * plotHeight;

      return {
        x,
        targetY,
        rawP,
        smoothedP: ema,
        sim_t: item.sim_t ?? idx,
        vib: item.vibration_rms,
        idx
      };
    });
  }, [recentHistory, plotLeft, plotWidth, plotBottom, plotHeight, maxWindow]);

  // DOM refs for direct, flicker-free rendering via requestAnimationFrame
  const pathRef = useRef<SVGPathElement | null>(null);
  const animCoordsRef = useRef<{ x: number; y: number }[]>([]);
  const animFrameIdRef = useRef<number | null>(null);

  // Helper function to build a smooth cubic Bezier curve through coordinates
  const buildCurveD = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${(pts[0].x + 1).toFixed(1)} ${pts[0].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const midX = (prev.x + curr.x) / 2;
      d += ` C ${midX.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
    return d;
  };

  // requestAnimationFrame smoothing loop: interpolates displayed curve smoothly toward target points
  useEffect(() => {
    // If history was cleared (restart or switch mode), reset immediately
    if (processedPoints.length === 0) {
      animCoordsRef.current = [];
      if (pathRef.current) {
        pathRef.current.setAttribute('d', '');
      }
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    // Align length of animated coordinates array with target points
    const current = animCoordsRef.current;
    if (current.length !== processedPoints.length) {
      if (current.length === 0) {
        animCoordsRef.current = processedPoints.map(p => ({ x: p.x, y: p.targetY }));
      } else if (current.length < processedPoints.length) {
        const last = current[current.length - 1];
        while (current.length < processedPoints.length) {
          const pt = processedPoints[current.length];
          current.push({ x: pt.x, y: last ? last.y : pt.targetY });
        }
      } else {
        animCoordsRef.current = current.slice(current.length - processedPoints.length);
      }
    }

    let isRunning = true;
    const lerpSpeed = 0.22; // Smooth transition speed between telemetry updates

    const renderFrame = () => {
      if (!isRunning) return;

      let maxDiff = 0;
      const pts = animCoordsRef.current;

      for (let i = 0; i < processedPoints.length; i++) {
        const target = processedPoints[i];
        if (!pts[i]) pts[i] = { x: target.x, y: target.targetY };

        // Lerp coordinates toward targets
        const dy = (target.targetY - pts[i].y) * lerpSpeed;
        const dx = (target.x - pts[i].x) * lerpSpeed;
        pts[i].y += dy;
        pts[i].x += dx;

        const diff = Math.max(Math.abs(dy), Math.abs(dx));
        if (diff > maxDiff) maxDiff = diff;
      }

      // Update the SVG path attribute directly without React rerender churn or flicker
      if (pathRef.current) {
        const d = buildCurveD(pts);
        pathRef.current.setAttribute('d', d);
      }

      // Keep animating smoothly if still gliding toward targets
      if (maxDiff > 0.08) {
        animFrameIdRef.current = requestAnimationFrame(renderFrame);
      } else {
        // Snap precisely to target to avoid drift
        for (let i = 0; i < processedPoints.length; i++) {
          pts[i].x = processedPoints[i].x;
          pts[i].y = processedPoints[i].targetY;
        }
        if (pathRef.current) {
          pathRef.current.setAttribute('d', buildCurveD(pts));
        }
        animFrameIdRef.current = null;
      }
    };

    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
    }
    animFrameIdRef.current = requestAnimationFrame(renderFrame);

    return () => {
      isRunning = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [processedPoints]);

  // Initial path string for SSR / initial paint
  const initialPathD = useMemo(() => {
    return buildCurveD(processedPoints.map(p => ({ x: p.x, y: p.targetY })));
  }, [processedPoints]);

  // --- Real Dynamic Event Detection (NO FAKE / HARDCODED NUMBERS) ---
  // 1. Detect when ML probability actually crossed >= 50%
  const mlCrossIndex = processedPoints.findIndex(pt => pt.smoothedP >= 0.50);
  const mlCrossPoint = mlCrossIndex >= 0 ? processedPoints[mlCrossIndex] : null;

  // 2. Detect when baseline vibration actually crossed standard alarm threshold (4.5 mm/s)
  const baselineCrossIndex = processedPoints.findIndex(pt => pt.vib !== undefined && pt.vib >= 4.5);
  const baselineCrossPoint = baselineCrossIndex >= 0 ? processedPoints[baselineCrossIndex] : null;

  // 3. Compute real lead time IF AND ONLY IF both have occurred in current window
  let dynamicLeadTime: number | null = null;
  if (mlCrossPoint && baselineCrossPoint) {
    dynamicLeadTime = +(baselineCrossPoint.sim_t - mlCrossPoint.sim_t).toFixed(1);
  }

  // Format seconds to mm:ss
  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --- Phase 3 Margin Before Cavitation Computations ---
  const marginMetrics = useMemo(() => {
    if (processedPoints.length < 3) {
      return {
        timeToThreshold: 'stable',
        severityMargin: 'stable',
        baselineComparison: baselineCrossPoint ? `Triggered at ${formatTime(baselineCrossPoint.sim_t)}` : 'Vibration alarm: not triggered'
      };
    }

    const latestPt = processedPoints[processedPoints.length - 1];
    const latestP = latestPt.smoothedP;

    // Look back ~5s
    const targetSimT = latestPt.sim_t - 5.0;
    let pastPt = processedPoints[0];
    for (let i = processedPoints.length - 1; i >= 0; i--) {
      if (processedPoints[i].sim_t <= targetSimT) {
        pastPt = processedPoints[i];
        break;
      }
    }

    const dt = latestPt.sim_t - pastPt.sim_t;
    const dp = latestP - pastPt.smoothedP;

    let timeToThreshold = 'stable';
    if (latestP >= 0.50) {
      timeToThreshold = 'Threshold reached';
    } else if (dt >= 1.5 && dp > 0.02) {
      const riseRate = dp / dt; // rise rate per second
      const remainingP = 0.50 - latestP;
      const secondsLeft = Math.round(remainingP / riseRate);
      if (secondsLeft > 0 && secondsLeft < 300) {
        timeToThreshold = `${secondsLeft} s (estimate)`;
      } else {
        timeToThreshold = 'not estimable';
      }
    } else {
      timeToThreshold = 'stable';
    }

    let severityMargin = 'stable';
    const currentSev = faultSeverityPercent || 0;
    if (latestP >= 0.50) {
      severityMargin = '0 % (threshold reached)';
    } else if (currentSev > 0 && latestP > 0.05) {
      const slope = latestP / currentSev;
      if (slope > 0.001) {
        const targetSev = 0.50 / slope;
        const marginPct = Math.max(0, Math.round(targetSev - currentSev));
        severityMargin = `+${marginPct} % (estimate)`;
      } else {
        severityMargin = 'not estimable';
      }
    } else {
      severityMargin = 'stable';
    }

    let baselineComparison = 'Vibration alarm: not triggered';
    if (mlCrossPoint && baselineCrossPoint) {
      const diff = +(baselineCrossPoint.sim_t - mlCrossPoint.sim_t).toFixed(1);
      if (diff > 0) {
        baselineComparison = `Warning ${diff} s before vibration alarm`;
      } else {
        baselineComparison = `Vibration alarm fired ${Math.abs(diff)} s before ML`;
      }
    } else if (baselineCrossPoint) {
      baselineComparison = `Vibration alarm triggered (${formatTime(baselineCrossPoint.sim_t)})`;
    }

    return { timeToThreshold, severityMargin, baselineComparison };
  }, [processedPoints, faultSeverityPercent, baselineCrossPoint, mlCrossPoint]);

  const activeFix = correctiveAction || CORRECTIVE_ACTIONS[activeFaultType] || CORRECTIVE_ACTIONS['suction_restriction'];

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
            (Live P = <span style={{ display: 'inline-block', minWidth: '26px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(currentProbability * 100)}</span> %)
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
            <span>Threshold alarm (vibration &ge; 4.5 mm/s)</span>
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
          {/* Y-Axis Grid Lines & Labels (Fixed 0 to 100%) */}
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

          {/* X-Axis Ticks & Labels (Fixed rolling 30 s window: 0, 10, 20, 30 s) */}
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

          {/* Real ML Probability Curve (Smoothly animated with requestAnimationFrame) */}
          <path
            ref={pathRef}
            d={initialPathD}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="3.0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

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
                Vibration alarm {formatTime(baselineCrossPoint.sim_t)}
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
                fontSize="12"
                fontWeight="700"
                fontFamily="monospace"
                textAnchor="middle"
              >
                {dynamicLeadTime > 0 ? `Warning ${dynamicLeadTime} s before vibration alarm` : `${Math.abs(dynamicLeadTime)} s after vibration alarm`}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Phase 3 Margin Before Cavitation Panel & Fix Guidance */}
      <div style={{
        marginTop: '8px',
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '10px 14px',
        display: 'grid',
        gridTemplateColumns: '1.2fr 1.2fr 1.6fr',
        gap: '12px',
        fontSize: '11.5px',
        alignItems: 'center'
      }}>
        {/* Estimated Time to Threshold */}
        <div>
          <div style={{ color: '#94a3b8', fontSize: '10.5px' }}>
            Estimated time to threshold (estimate)
          </div>
          <div style={{
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: marginMetrics.timeToThreshold.includes('s') ? '#f59e0b' : '#34d399',
            marginTop: '2px'
          }}>
            {marginMetrics.timeToThreshold}
          </div>
        </div>

        {/* Severity Margin */}
        <div>
          <div style={{ color: '#94a3b8', fontSize: '10.5px' }}>
            Severity margin (estimate)
          </div>
          <div style={{
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: marginMetrics.severityMargin.includes('+') ? '#38bdf8' : '#cbd5e1',
            marginTop: '2px'
          }}>
            {marginMetrics.severityMargin}
          </div>
        </div>

        {/* Baseline Vibration Comparison & Corrective Guidance */}
        <div>
          <div style={{ color: '#94a3b8', fontSize: '10.5px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Baseline comparison (4.5 mm/s)</span>
            <span style={{ color: '#f8fafc', fontFamily: 'monospace', fontWeight: 600 }}>{marginMetrics.baselineComparison}</span>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#38bdf8',
            marginTop: '3px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }} title={activeFix}>
            <strong style={{ color: '#cbd5e1' }}>Action: </strong>{activeFix}
          </div>
        </div>
      </div>
    </div>
  );
};

