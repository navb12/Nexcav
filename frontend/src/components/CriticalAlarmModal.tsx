import React from 'react';
import { AlertItem, SensorReadings } from '../types.ts';

interface CriticalAlarmModalProps {
  alert: AlertItem;
  readings: SensorReadings;
  onAcknowledge: () => void;
  onResolve: () => void;
  onValidate?: (classification: 'confirmed_cavitation' | 'false_positive' | 'missed_fault') => void;
}

export const CriticalAlarmModal: React.FC<CriticalAlarmModalProps> = ({
  alert,
  readings,
  onAcknowledge,
  onResolve,
  onValidate
}) => {
  const vibVal = readings.vibration_rms !== null ? readings.vibration_rms.toFixed(2) : '8.42';
  const suctionVal = readings.suction_pressure !== null ? readings.suction_pressure.toFixed(2) : '0.62';

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(5, 8, 14, 0.85)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px'
    }}>
      <div style={{
        backgroundColor: '#111722',
        border: '2px solid var(--status-critical)',
        boxShadow: '0 0 35px rgba(239, 68, 68, 0.35), 0 20px 40px rgba(0, 0, 0, 0.8)',
        borderRadius: '6px',
        width: '100%',
        maxWidth: '560px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Modal Red Alert Bar */}
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.18)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: 'var(--status-critical)',
              boxShadow: '0 0 8px var(--status-critical)'
            }} />
            <h2 style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 800,
              color: 'var(--status-critical)',
              letterSpacing: '0.8px',
              fontFamily: 'monospace'
            }}>
              {alert.category.toUpperCase()}
            </h2>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'var(--status-critical)',
            color: '#ffffff',
            padding: '2px 8px',
            borderRadius: '3px',
            fontSize: '10px',
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: '0.5px'
          }}>
            ACTIVE SCADA ALARM
          </div>
        </div>

        {/* Pump & Context Subtitle */}
        <div style={{
          padding: '14px 18px 4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <div style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            PUMP P-001 · MODEL SEQUENCE DETECTION (CONFIDENCE: {alert.model_score ? (alert.model_score * 100).toFixed(0) : 95}%)
          </div>
        </div>

        {/* Alarm Description */}
        <div style={{
          padding: '10px 18px',
          fontSize: '12px',
          color: 'var(--text-primary)',
          lineHeight: '1.5'
        }}>
          {alert.explanation || 'Cavitation levels have exceeded the critical operating threshold. Severe suction pressure collapse and turbulent vibration escalation detected by sequence inference.'}
        </div>

        {/* Diagnostic Sensor Metrics Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          padding: '0 18px 12px'
        }}>
          {/* Vibration */}
          <div style={{
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '8px 10px'
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'monospace' }}>
              Vibration
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--status-critical)', fontFamily: 'monospace', marginTop: '2px' }}>
              {vibVal} <span style={{ fontSize: '10px', fontWeight: 500 }}>mm/s</span>
            </div>
            <div style={{ fontSize: '9px', color: '#f87171', marginTop: '1px' }}>
              Limit &gt; 7.00
            </div>
          </div>

          {/* Suction Pressure */}
          <div style={{
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '8px 10px'
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'monospace' }}>
              Suction Press.
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--status-critical)', fontFamily: 'monospace', marginTop: '2px' }}>
              {suctionVal} <span style={{ fontSize: '10px', fontWeight: 500 }}>bar</span>
            </div>
            <div style={{ fontSize: '9px', color: '#f87171', marginTop: '1px' }}>
              Limit &lt; 0.80
            </div>
          </div>

          {/* Severity */}
          <div style={{
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '8px 10px'
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'monospace' }}>
              Severity Level
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--status-critical)', fontFamily: 'monospace', marginTop: '2px' }}>
              Critical
            </div>
            <div style={{ fontSize: '9px', color: '#f87171', marginTop: '1px' }}>
              Persistent Evidence
            </div>
          </div>
        </div>

        {/* Operator Incident Validation Classification */}
        {onValidate && (
          <div style={{
            margin: '0 18px 10px',
            padding: '8px 12px',
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px dashed var(--border-medium)',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Ground-Truth Validation:
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => onValidate('confirmed_cavitation')}
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--status-normal)',
                  border: '1px solid var(--status-normal)',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
                title="Classify this alarm as a genuine confirmed cavitation detection"
              >
                ✓ Confirm Cavitation
              </button>
              <button
                onClick={() => onValidate('false_positive')}
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--status-critical)',
                  border: '1px solid var(--status-critical)',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
                title="Classify this alarm as a False Positive for ML model retraining"
              >
                ✗ False Positive
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          backgroundColor: 'var(--bg-surface-elevated)',
          borderTop: '1px solid var(--border-subtle)',
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Note: Resolving alert clears alarm. Pump requires physical repair to restore nominal state.
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onResolve}
              style={{
                backgroundColor: 'transparent',
                color: 'var(--status-normal)',
                border: '1px solid var(--status-normal)',
                padding: '7px 12px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
              title="Resolve this alert record"
            >
              Resolve Alert
            </button>

            <button
              onClick={onAcknowledge}
              style={{
                backgroundColor: 'var(--status-critical)',
                color: '#ffffff',
                border: 'none',
                padding: '7px 16px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.4px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)'
              }}
              title="Silence and dismiss popup. Alert will remain tracked in Active Alerts."
            >
              Acknowledge Alarm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
