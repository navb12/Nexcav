import React from 'react';
import { ThresholdBreach, FeatureAttribution, SequenceFeatures, PredictionHistoryItem } from '../types.ts';

interface RiskGaugeProps {
  score: number; // 0.0 to 1.0 (calibrated sequence cavitation probability)
  riskLevel: number; // 0: Normal, 1: Moderate/Warning, 2: Critical
  status: string;
  trajectory?: 'Stable' | 'Deteriorating' | 'Improving';
  riskVelocity?: number;
  sequenceFeatures?: SequenceFeatures;
  predictionHistory?: PredictionHistoryItem[];
  modelVersion?: string;
  breaches?: ThresholdBreach[];
  attributions?: FeatureAttribution[];
  activeAlertCount?: number;
  onAcknowledgeAll?: () => void;
}

export const RiskGauge: React.FC<RiskGaugeProps> = ({
  score = 0.05,
  riskLevel = 0,
  status = 'Normal Operation',
  trajectory = 'Stable',
  riskVelocity = 0.0,
  sequenceFeatures,
  predictionHistory = [],
  modelVersion = 'v2.1.0-timeseries',
  breaches = [],
  attributions = [],
  activeAlertCount = 0,
  onAcknowledgeAll
}) => {
  const scorePct = Math.round(score * 100);

  const isCritical = score >= 0.70 || riskLevel >= 2;
  const isModerate = !isCritical && (score >= 0.35 || riskLevel >= 1);

  const categoryColor = isCritical
    ? 'var(--status-critical)'
    : isModerate
    ? 'var(--status-warning)'
    : 'var(--status-normal)';

  const categoryLabel = isCritical
    ? 'SEVERE CAVITATION DETECTED'
    : isModerate
    ? 'DEVELOPING CAVITATION PATTERN'
    : 'NORMAL HYDRODYNAMIC MARGIN';

  const categoryDescription = isCritical
    ? 'Sustained suction pressure breakdown and elevated RMS vibration confirmed across consecutive sequence windows.'
    : isModerate
    ? 'Persistent downward suction drift and rising vibration rate detected by sequence model prior to critical threshold breaches.'
    : 'Stable suction vapor margin and nominal pressure differential. Operating within ISO continuous operating limits.';

  const trajColor = trajectory === 'Deteriorating'
    ? 'var(--status-critical)'
    : trajectory === 'Improving'
    ? 'var(--status-normal)'
    : 'var(--text-secondary)';

  const trajIcon = trajectory === 'Deteriorating' ? '▲' : trajectory === 'Improving' ? '▼' : '●';

  // SVG mini-sparkline for historical prediction probability (last 30-60s)
  const sparkPoints = predictionHistory.map((p, idx) => {
    const x = (idx / Math.max(1, predictionHistory.length - 1)) * 140;
    const y = 28 - (Math.max(0, Math.min(1, p.model_score || p.probability || 0)) * 24);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const topFactors = attributions.slice(0, 3);

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: `1px solid ${isCritical ? 'var(--status-critical)' : 'var(--border-subtle)'}`,
      borderRadius: '6px',
      padding: '10px 14px',
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 1.2fr) minmax(280px, 1.2fr) minmax(250px, 1fr)',
      gap: '12px',
      alignItems: 'center',
      minHeight: 0,
      flexShrink: 0
    }}>
      {/* Column 1: Calibrated Prediction Probability & Historical Trajectory */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>
            Cavitation Prediction Index
          </span>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Sequence Model ({modelVersion})
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{
              fontSize: '34px',
              fontWeight: 800,
              lineHeight: 1,
              color: categoryColor,
              fontFamily: 'monospace',
              letterSpacing: '-1px'
            }}>
              {scorePct}%
            </span>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{
                fontSize: '12.5px',
                fontWeight: 800,
                color: categoryColor,
                letterSpacing: '0.2px',
                fontFamily: 'monospace'
              }}>
                {categoryLabel}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Condition: <strong style={{ color: 'var(--text-primary)' }}>{status}</strong>
              </span>
            </div>
          </div>

          {/* Trajectory Pill */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            backgroundColor: 'var(--bg-surface-subtle)',
            border: `1px solid ${trajColor}`,
            padding: '2px 7px',
            borderRadius: '4px'
          }}>
            <span style={{ fontSize: '10.5px', fontWeight: 800, color: trajColor, fontFamily: 'monospace' }}>
              {trajIcon} {trajectory.toUpperCase()}
            </span>
            <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {riskVelocity > 0 ? `+${riskVelocity}%/min` : `${riskVelocity}%/min`}
            </span>
          </div>
        </div>

        {/* Stepped Scale & 30-Second Trend Sparkline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: '3px', height: '5px', width: '100%' }}>
              <div style={{
                flex: 3.5,
                borderRadius: '2px',
                backgroundColor: score >= 0.02 ? 'var(--status-normal)' : 'var(--bg-surface-elevated)',
                opacity: score < 0.35 ? 1 : 0.35
              }} />
              <div style={{
                flex: 3.5,
                borderRadius: '2px',
                backgroundColor: score >= 0.35 ? 'var(--status-warning)' : 'var(--bg-surface-elevated)',
                opacity: score >= 0.35 && score < 0.70 ? 1 : 0.35
              }} />
              <div style={{
                flex: 3.0,
                borderRadius: '2px',
                backgroundColor: score >= 0.70 ? 'var(--status-critical)' : 'var(--bg-surface-elevated)',
                opacity: score >= 0.70 ? 1 : 0.25
              }} />
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '9.5px',
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              marginTop: '3px'
            }}>
              <span>0% SAFE</span>
              <span>35% WARNING</span>
              <span>70% CRITICAL</span>
              <span>100%</span>
            </div>
          </div>

          {/* Mini Probability Sparkline */}
          {predictionHistory.length > 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <svg width="70" height="20" style={{ overflow: 'visible' }}>
                <polyline
                  fill="none"
                  stroke={categoryColor}
                  strokeWidth="1.6"
                  points={sparkPoints}
                />
              </svg>
              <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                30s Trend
              </span>
            </div>
          )}
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
          {categoryDescription}
        </div>
      </div>

      {/* Column 2: Sequence Feature Patterns & Temporal Drivers */}
      <div style={{
        backgroundColor: 'var(--bg-surface-subtle)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '5px',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          fontWeight: 700,
          color: 'var(--text-primary)'
        }}>
          <span>Contributing Telemetry Patterns</span>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Rolling 30s Window</span>
        </div>

        {sequenceFeatures ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px', fontFamily: 'monospace' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Suction Drift Slope:</span>
              <span style={{
                color: sequenceFeatures.slope_suction < -0.015 ? 'var(--status-critical)' : 'var(--text-primary)',
                fontWeight: 700
              }}>
                {sequenceFeatures.slope_suction > 0 ? `+${sequenceFeatures.slope_suction}` : sequenceFeatures.slope_suction} bar/s
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Vibration Trend Slope:</span>
              <span style={{
                color: sequenceFeatures.slope_vibration > 0.05 ? 'var(--status-warning)' : 'var(--text-primary)',
                fontWeight: 700
              }}>
                {sequenceFeatures.slope_vibration > 0 ? `+${sequenceFeatures.slope_vibration}` : sequenceFeatures.slope_vibration} mm/s²
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Vapor Pressure Margin:</span>
              <span style={{
                color: sequenceFeatures.suction_vapor_margin < 0.8 ? 'var(--status-critical)' : 'var(--status-normal)',
                fontWeight: 700
              }}>
                {sequenceFeatures.suction_vapor_margin} bar
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Differential Head ΔP:</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {sequenceFeatures.head_diff} bar
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Flow Rate Deviation:</span>
              <span style={{
                color: sequenceFeatures.flow_deviation_pct < -10 ? 'var(--status-warning)' : 'var(--text-primary)'
              }}>
                {sequenceFeatures.flow_deviation_pct > 0 ? `+${sequenceFeatures.flow_deviation_pct}%` : `${sequenceFeatures.flow_deviation_pct}%`}
              </span>
            </div>
          </div>
        ) : topFactors.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px', fontFamily: 'monospace' }}>
            {topFactors.map(f => (
              <div key={f.feature} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{f.label || f.feature}:</span>
                <span style={{ color: 'var(--text-primary)' }}>{f.value} {f.unit}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '4px 0' }}>
            Stabilizing 30-second historical sequence window...
          </div>
        )}

        {breaches.length > 0 && (
          <div style={{
            paddingTop: '3px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '10.5px',
            color: 'var(--status-warning)',
            fontFamily: 'monospace'
          }}>
            Threshold limit: {breaches.map(b => `${b.label || b.sensor} (${b.value})`).join(', ')}
          </div>
        )}
      </div>

      {/* Column 3: Machinery Protection Status & Diagnostic Action */}
      <div style={{
        backgroundColor: isCritical
          ? 'rgba(239, 68, 68, 0.12)'
          : isModerate
          ? 'rgba(245, 158, 11, 0.12)'
          : 'rgba(16, 185, 129, 0.08)',
        border: `1px solid ${categoryColor}`,
        borderRadius: '5px',
        padding: '9px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontSize: '12px',
            fontWeight: 800,
            color: categoryColor,
            fontFamily: 'monospace',
            letterSpacing: '0.4px'
          }}>
            {isCritical ? '⚠ CRITICAL CAVITATION ALARM' : isModerate ? '▲ DEVELOPING CAVITATION WARNING' : '✓ HEALTHY OPERATION'}
          </span>
          {onAcknowledgeAll && activeAlertCount > 0 && isCritical && (
            <button
              onClick={onAcknowledgeAll}
              style={{
                backgroundColor: 'var(--status-critical)',
                color: '#ffffff',
                border: 'none',
                padding: '3px 8px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              ACK ({activeAlertCount})
            </button>
          )}
        </div>

        <div style={{
          fontSize: '11.5px',
          color: isCritical ? '#fecaca' : isModerate ? '#fef08a' : 'var(--text-secondary)',
          lineHeight: 1.35,
          margin: '4px 0'
        }}>
          {isCritical
            ? 'Critical suction vapor breakdown confirmed by model sequence persistence. Throttle discharge valve or increase suction head immediately.'
            : isModerate
            ? 'Developing cavitation pattern detected. Negative suction drift identified before severe destructive vibration occurs. Inspect inlet strainers.'
            : 'Positive NPSHa margin verified. Centrifugal pump operating stably within nominal curve with low hydrodynamic variance.'}
        </div>

        <div style={{
          fontSize: '10px',
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>PERSISTENCE: 3-WINDOW VERIFIED</span>
          <span style={{ color: categoryColor, fontWeight: 700 }}>
            {isCritical ? 'ACTION REQUIRED' : isModerate ? 'MONITOR TREND' : 'NORMAL'}
          </span>
        </div>
      </div>
    </div>
  );
};
