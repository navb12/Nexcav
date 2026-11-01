import React from 'react';

interface SimulationControlsProps {
  running: boolean;
  simTime?: number;
  activeFaults?: string[];
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onInjectFault: (fault: string) => void;
  onResolveFault: (fault: string) => void;
}

export const SimulationControls: React.FC<SimulationControlsProps> = ({
  running,
  simTime = 0,
  activeFaults = [],
  onStart,
  onPause,
  onReset,
  onInjectFault,
  onResolveFault
}) => {
  const faultButtons = [
    { id: 'developing_cavitation', label: 'Developing Cavitation', isCritical: false },
    { id: 'severe_cavitation', label: 'Severe Cavitation', isCritical: true },
    { id: 'bearing_wear', label: 'Bearing Wear', isCritical: false },
    { id: 'pressure_drop', label: 'Pressure Drop', isCritical: true }
  ];

  const hasCriticalActive = activeFaults.includes('severe_cavitation') || activeFaults.includes('pressure_drop');

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '5px',
      padding: '7px 16px',
      display: 'flex',
      flexWrap: 'nowrap',
      gap: '12px',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      {/* Group 1: Execution Control (Start/Pause, Reset, Clock & Health Status) */}
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
              padding: '5px 14px',
              borderRadius: '3px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Pause continuous telemetry execution (preserves active faults)"
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
              padding: '5px 16px',
              borderRadius: '3px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
            title="Resume telemetry execution"
          >
            ▶ Run Simulation
          </button>
        )}

        <button
          onClick={onReset}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            padding: '5px 12px',
            borderRadius: '3px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          title="Reset to initial nominal baseline & clear all active faults (requires confirmation if faults active)"
        >
          ↺ Reset
        </button>

        {/* Live Simulation Clock & Fault State Status */}
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
            color: activeFaults.length === 0
              ? 'var(--status-normal)'
              : hasCriticalActive
              ? 'var(--status-critical)'
              : 'var(--status-warning)',
            fontSize: '11px',
            fontWeight: 700,
            borderLeft: '1px solid var(--border-subtle)',
            paddingLeft: '6px'
          }}>
            {activeFaults.length === 0
              ? '● HEALTHY BASELINE'
              : `▲ ${activeFaults.length} FAULT${activeFaults.length > 1 ? 'S' : ''} ACTIVE`}
          </span>
        </div>
      </div>

      {/* Group 2: Manual Fault Injection & Explicit Individual Resolution */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Manual Faults:
        </span>
        
        {faultButtons.map((fb) => {
          const isActive = activeFaults.includes(fb.id);
          const activeColor = fb.isCritical ? 'var(--status-critical)' : 'var(--status-warning)';
          const activeBg = fb.isCritical ? 'rgba(239, 68, 68, 0.16)' : 'rgba(245, 158, 11, 0.16)';

          return (
            <div
              key={fb.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: isActive ? activeBg : 'transparent',
                border: `1px solid ${isActive ? activeColor : 'var(--border-subtle)'}`,
                borderRadius: '3px',
                overflow: 'hidden'
              }}
            >
              {/* Fault Button: Inject or Active Badge */}
              <button
                onClick={() => onInjectFault(fb.id)}
                style={{
                  backgroundColor: 'transparent',
                  color: isActive ? activeColor : 'var(--text-secondary)',
                  border: 'none',
                  padding: '4px 8px',
                  fontSize: '11.5px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
                title={isActive ? `${fb.label} is currently ACTIVE (click to toggle)` : `Click to inject ${fb.label}`}
              >
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isActive ? activeColor : 'var(--text-muted)'
                }} />
                <span>{fb.label}</span>
                {isActive && <span style={{ fontSize: '10px', opacity: 0.9 }}>[ACTIVE]</span>}
              </button>

              {/* Explicit Resolve Button (Shown when fault is active) */}
              {isActive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolveFault(fb.id);
                  }}
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.18)',
                    color: 'var(--status-normal)',
                    border: 'none',
                    borderLeft: `1px solid ${activeColor}`,
                    padding: '4px 7px',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px'
                  }}
                  title={`Explicitly resolve ${fb.label} and restore affected parameters`}
                >
                  ✓ Resolve
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
