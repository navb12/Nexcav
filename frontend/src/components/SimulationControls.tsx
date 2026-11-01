import React from 'react';
import { PumpActuators } from '../types.ts';

interface SimulationControlsProps {
  running: boolean;
  simTime?: number;
  actuators?: PumpActuators;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onActuate: (actuator: string, delta: number, intensity?: number) => void;
  onRepairPump: () => void;
}

export const SimulationControls: React.FC<SimulationControlsProps> = ({
  running,
  simTime = 0,
  actuators = {
    suction_restriction: 0,
    bearing_wear: 0,
    discharge_throttling: 0,
    vibration_unbalance: 0
  },
  onStart,
  onPause,
  onReset,
  onActuate,
  onRepairPump
}) => {
  const suctPct = Math.round((actuators.suction_restriction || 0) * 100);
  const brgPct = Math.round((actuators.bearing_wear || 0) * 100);
  const discPct = Math.round((actuators.discharge_throttling || 0) * 100);
  const unbPct = Math.round((actuators.vibration_unbalance || 0) * 100);

  const totalDegradation = suctPct + brgPct + discPct + unbPct;
  const isHealthy = totalDegradation === 0;

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '5px',
      padding: '7px 16px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      {/* Group 1: Execution Control (Start/Pause, Clock & Pump Equipment State) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {running ? (
          <button
            onClick={onPause}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-surface-elevated)',
              color: 'var(--status-warning)',
              border: '1px solid var(--border-medium)',
              padding: '5px 12px',
              borderRadius: '3px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Pause continuous telemetry execution"
          >
            ❚❚ Pause
          </button>
        ) : (
          <button
            onClick={onStart}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--accent-cyan)',
              color: '#0b0f17',
              border: 'none',
              padding: '5px 14px',
              borderRadius: '3px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Resume telemetry execution"
          >
            ▶ Run
          </button>
        )}

        <button
          onClick={onReset}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            padding: '5px 10px',
            borderRadius: '3px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          title="Reset simulation clock"
        >
          ↺ Reset
        </button>

        {/* Live Simulation Clock & Equipment State */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginLeft: '4px',
          padding: '3px 8px',
          borderRadius: '3px',
          backgroundColor: 'var(--bg-surface-subtle)',
          border: '1px solid var(--border-subtle)',
          fontSize: '12px',
          fontFamily: 'monospace'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>T:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{simTime.toFixed(1)}s</span>
          <span style={{
            color: isHealthy ? 'var(--status-normal)' : 'var(--status-warning)',
            fontSize: '11px',
            fontWeight: 700,
            borderLeft: '1px solid var(--border-subtle)',
            paddingLeft: '6px'
          }}>
            {isHealthy ? '● HEALTHY PUMP' : `▲ MODIFIED CONDITIONS (${totalDegradation}%)`}
          </span>
        </div>
      </div>

      {/* Group 2: Physical Condition Actuators (Zero direct alerts - continuous progressive control) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Physical Actuators:
        </span>

        {/* 1. Suction Valve Throttling */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: suctPct > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-surface-subtle)',
          border: `1px solid ${suctPct > 0 ? 'var(--status-critical)' : 'var(--border-subtle)'}`,
          borderRadius: '3px',
          padding: '2px 6px',
          gap: '6px',
          fontSize: '11.5px'
        }}>
          <span style={{ color: suctPct > 0 ? 'var(--status-critical)' : 'var(--text-primary)', fontWeight: 600 }}>
            Suction Throttle:
          </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: suctPct > 0 ? 'var(--status-critical)' : 'var(--accent-cyan)' }}>
            {suctPct}%
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={() => onActuate('suction_restriction', -0.25)}
              disabled={suctPct <= 0}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: suctPct <= 0 ? 'not-allowed' : 'pointer',
                opacity: suctPct <= 0 ? 0.4 : 1
              }}
              title="Open suction valve (-25%)"
            >
              -
            </button>
            <button
              onClick={() => onActuate('suction_restriction', 0.25)}
              disabled={suctPct >= 100}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--status-critical)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: suctPct >= 100 ? 'not-allowed' : 'pointer',
                opacity: suctPct >= 100 ? 0.4 : 1
              }}
              title="Throttle suction valve (+25% restriction)"
            >
              +
            </button>
          </div>
        </div>

        {/* 2. Bearing Friction Wear */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: brgPct > 0 ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-surface-subtle)',
          border: `1px solid ${brgPct > 0 ? 'var(--status-warning)' : 'var(--border-subtle)'}`,
          borderRadius: '3px',
          padding: '2px 6px',
          gap: '6px',
          fontSize: '11.5px'
        }}>
          <span style={{ color: brgPct > 0 ? 'var(--status-warning)' : 'var(--text-primary)', fontWeight: 600 }}>
            Bearing Wear:
          </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: brgPct > 0 ? 'var(--status-warning)' : 'var(--accent-cyan)' }}>
            {brgPct}%
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={() => onActuate('bearing_wear', -0.35)}
              disabled={brgPct <= 0}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: brgPct <= 0 ? 'not-allowed' : 'pointer',
                opacity: brgPct <= 0 ? 0.4 : 1
              }}
              title="Reduce bearing wear (-35%)"
            >
              -
            </button>
            <button
              onClick={() => onActuate('bearing_wear', 0.35)}
              disabled={brgPct >= 100}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--status-warning)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: brgPct >= 100 ? 'not-allowed' : 'pointer',
                opacity: brgPct >= 100 ? 0.4 : 1
              }}
              title="Increase bearing raceway degradation (+35%)"
            >
              +
            </button>
          </div>
        </div>

        {/* 3. Discharge Valve Throttling */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: discPct > 0 ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-surface-subtle)',
          border: `1px solid ${discPct > 0 ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
          borderRadius: '3px',
          padding: '2px 6px',
          gap: '6px',
          fontSize: '11.5px'
        }}>
          <span style={{ color: discPct > 0 ? 'var(--accent-cyan)' : 'var(--text-primary)', fontWeight: 600 }}>
            Discharge Valve:
          </span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--accent-cyan)' }}>
            {discPct}%
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={() => onActuate('discharge_throttling', -0.30)}
              disabled={discPct <= 0}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: discPct <= 0 ? 'not-allowed' : 'pointer',
                opacity: discPct <= 0 ? 0.4 : 1
              }}
              title="Open discharge valve (-30%)"
            >
              -
            </button>
            <button
              onClick={() => onActuate('discharge_throttling', 0.30)}
              disabled={discPct >= 100}
              style={{
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--accent-cyan)',
                border: '1px solid var(--border-medium)',
                borderRadius: '2px',
                cursor: discPct >= 100 ? 'not-allowed' : 'pointer',
                opacity: discPct >= 100 ? 0.4 : 1
              }}
              title="Throttle discharge valve (+30%)"
            >
              +
            </button>
          </div>
        </div>

        {/* 4. Equipment Maintenance Action (Physically restores pump back to baseline) */}
        {!isHealthy && (
          <button
            onClick={onRepairPump}
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.18)',
              color: 'var(--status-normal)',
              border: '1px solid var(--status-normal)',
              padding: '4px 10px',
              borderRadius: '3px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Perform physical pump maintenance: flush valves, replace bearings, restore nominal baseline"
          >
            🔧 Repair Pump
          </button>
        )}
      </div>
    </div>
  );
};
