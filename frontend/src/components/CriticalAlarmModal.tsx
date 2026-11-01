import React from 'react';
import { AlertItem, SensorReadings } from '../types.ts';

interface CriticalAlarmModalProps {
  alert: AlertItem;
  readings: SensorReadings;
  onAcknowledge: () => void;
  onResolve: () => void;
}

export const CriticalAlarmModal: React.FC<CriticalAlarmModalProps> = ({
  alert,
  readings,
  onAcknowledge,
  onResolve
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
        maxWidth: '540px',
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
            ACTIVE
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
            fontSize: '12px',
            fontWeight: 700,
            color: '#f87171',
            fontFamily: 'monospace'
          }}>
            Severe Cavitation
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
            letterSpacing: '0.4px'
          }}>
            PUMP P-001 · LIVE SIMULATION
          </div>
        </div>

        {/* Alarm Description */}
        <div style={{
          padding: '10px 18px',
          fontSize: '12px',
          color: 'var(--text-primary)',
          lineHeight: '1.5'
        }}>
          {alert.explanation || 'Cavitation levels have exceeded the critical operating threshold. Abnormal pressure fluctuations and increased vibration detected.'}
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
              Severity
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--status-critical)', fontFamily: 'monospace', marginTop: '2px' }}>
              Critical
            </div>
            <div style={{ fontSize: '9px', color: '#f87171', marginTop: '1px' }}>
              Zone D Breakdown
            </div>
          </div>
        </div>

        {/* Alarm Status & Unacknowledged Callout */}
        <div style={{
          margin: '0 18px 14px',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '4px',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
          fontFamily: 'monospace'
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Alarm status: <strong style={{ color: '#fca5a5' }}>Unacknowledged</strong>
          </span>
          <span style={{
            color: 'var(--status-critical)',
            fontWeight: 700,
            fontSize: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            padding: '1px 6px',
            borderRadius: '2px'
          }}>
            ACTIVE
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{
          backgroundColor: 'var(--bg-surface-elevated)',
          borderTop: '1px solid var(--border-subtle)',
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px'
        }}>
          <button
            onClick={onResolve}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--status-normal)',
              border: '1px solid var(--status-normal)',
              padding: '7px 14px',
              borderRadius: '3px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Resolve the underlying fault and clear alarm"
          >
            Resolve Fault
          </button>

          <button
            onClick={onAcknowledge}
            style={{
              backgroundColor: 'var(--status-critical)',
              color: '#ffffff',
              border: 'none',
              padding: '7px 18px',
              borderRadius: '3px',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.4px',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)'
            }}
            title="Silence and dismiss popup. Underlying fault will remain active."
          >
            Acknowledge Alarm
          </button>
        </div>
      </div>
    </div>
  );
};

