import React from 'react';

interface AnimatedPumpProps {
  rpm: number | null;
  vibration: number | null;
  severity: number;
  status: string;
  running: boolean;
}

export const AnimatedPump: React.FC<AnimatedPumpProps> = ({
  rpm = 2950,
  vibration = 1.85,
  severity = 0.05,
  status = 'Normal Operation',
  running = true
}) => {
  const currentRpm = rpm ?? 0;
  const currentVib = vibration ?? 1.85;

  // Rotation duration based on physical shaft RPM
  const spinSpeedSec = running && currentRpm > 100 
    ? Math.max(0.35, 2400 / Math.max(currentRpm, 100)) 
    : 0;

  // Flow animation speed based on running state and RPM
  const flowAnimDuration = running ? `${Math.max(0.6, 2200 / Math.max(currentRpm, 200))}s` : '0s';

  const isCritical = severity >= 1.5 || status.includes('High') || status.includes('Severe') || status.includes('CRITICAL');
  const isModerate = !isCritical && (severity >= 1.0 || status.includes('Moderate') || status.includes('Developing'));
  const isMild = !isCritical && !isModerate && (severity >= 0.4 || status.includes('Possible') || status.includes('Mild') || status.includes('Early'));

  const statusColor = isCritical 
    ? 'var(--status-critical)' 
    : isModerate || isMild 
    ? 'var(--status-warning)' 
    : 'var(--status-normal)';

  const statusText = isCritical
    ? 'CRITICAL CAVITATION'
    : isModerate
    ? 'MODERATE CAVITATION'
    : isMild
    ? 'EARLY CAVITATION'
    : running
    ? 'RUNNING'
    : 'STOPPED';

  // Physical shake displacement from vibration
  const shakeX = isCritical ? Math.sin(Date.now() / 40) * 1.5 : 0;
  const shakeY = isCritical ? Math.cos(Date.now() / 40) * 1.5 : 0;

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      minHeight: 0,
      backgroundColor: 'var(--bg-surface)',
      border: `1px solid ${isCritical ? 'var(--status-critical)' : 'var(--border-subtle)'}`,
      borderRadius: '6px',
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      overflow: 'hidden'
    }}>
      {/* 1. Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>
          Centrifugal Pump
        </span>

        {/* Operational State Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          backgroundColor: 'var(--bg-surface-subtle)',
          padding: '2px 8px',
          borderRadius: '3px',
          border: `1px solid ${statusColor}44`
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: running ? statusColor : 'var(--text-muted)'
          }} />
          <span style={{
            fontSize: '11px',
            fontWeight: 800,
            fontFamily: 'monospace',
            color: running ? statusColor : 'var(--text-muted)'
          }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* 2. Simplified, Clean 2D Pump Cross-Section */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        flex: 1,
        minHeight: 0,
        margin: '2px 0'
      }}>
        <svg
          viewBox="0 0 360 200"
          style={{
            width: '100%',
            maxWidth: '360px',
            height: '100%',
            maxHeight: '180px',
            transform: `translate(${shakeX}px, ${shakeY}px)`,
            overflow: 'visible'
          }}
        >
          <defs>
            {/* Volute Casing Gradient */}
            <linearGradient id="pumpVoluteMetal" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="60%" stopColor="#131c2a" />
              <stop offset="100%" stopColor="#0b111a" />
            </linearGradient>

            {/* Suction & Discharge Tube Fill */}
            <linearGradient id="tubeMetal" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#243144" />
              <stop offset="100%" stopColor="#151f2e" />
            </linearGradient>
          </defs>

          {/* Simple Ground Stand */}
          <rect x="70" y="184" width="220" height="6" rx="2" fill="#1b2535" stroke="#2c3a50" strokeWidth="1" />
          <path d="M 135 158 L 125 184 L 195 184 L 185 158 Z" fill="#151f2e" stroke="#2c3a50" strokeWidth="1" />

          {/* Suction Inlet Pipe (Left Horizontal) */}
          <rect x="25" y="105" width="105" height="36" fill="url(#tubeMetal)" stroke="#334155" strokeWidth="1.2" />
          {/* Suction Flange */}
          <rect x="22" y="98" width="8" height="50" rx="1" fill="#2d3d54" stroke="#475569" strokeWidth="1.2" />

          {/* Discharge Outlet Nozzle (Top Vertical) */}
          <rect x="142" y="16" width="36" height="55" fill="url(#tubeMetal)" stroke="#334155" strokeWidth="1.2" />
          {/* Discharge Flange */}
          <rect x="135" y="14" width="50" height="8" rx="1" fill="#2d3d54" stroke="#475569" strokeWidth="1.2" />

          {/* Centrifugal Volute Spiral Casing */}
          <path
            d="M 142 68 
               C 192 64, 226 94, 226 128 
               C 226 168, 185 178, 150 178 
               C 105 178, 80 152, 80 120 
               C 80 86, 110 68, 142 68 Z"
            fill="url(#pumpVoluteMetal)"
            stroke={isCritical ? 'var(--status-critical)' : isModerate ? 'var(--status-warning)' : '#38bdf8'}
            strokeWidth="1.8"
          />

          {/* Fluid Flow Streamlines (Animated) */}
          {running && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Suction Line: Horizontal Into Center */}
              <path
                d="M 28 123 L 155 123"
                fill="none"
                stroke={isCritical ? '#fca5a5' : isModerate ? '#fde68a' : '#38bdf8'}
                strokeWidth={isCritical ? 2.5 : 2}
                strokeDasharray="6 5"
                style={{
                  animation: `flowDash ${flowAnimDuration} infinite linear`,
                  opacity: 0.95
                }}
              />

              {/* Volute Spiral Flow: Eye Around to Discharge */}
              <path
                d="M 155 123 C 185 123, 206 140, 195 160 C 175 180, 105 175, 96 130 C 90 98, 120 75, 160 75 L 160 20"
                fill="none"
                stroke={isCritical ? '#ef4444' : isModerate ? '#f59e0b' : '#38bdf8'}
                strokeWidth={isCritical ? 3 : 2.2}
                strokeDasharray={isCritical ? '10 8' : '7 5'}
                style={{
                  animation: isCritical
                    ? `flowTurbulent ${flowAnimDuration} infinite ease-in-out`
                    : `flowDash ${flowAnimDuration} infinite linear`,
                  opacity: 0.85
                }}
              />
            </g>
          )}

          {/* Centered Rotating Impeller Assembly */}
          <g transform="translate(155, 123)">
            {/* Spinning Blades */}
            <g style={{
              transformOrigin: '0 0',
              animation: spinSpeedSec > 0 ? `impellerSpin ${spinSpeedSec}s infinite linear` : 'none'
            }}>
              {/* Impeller Backplate Disk */}
              <circle cx="0" cy="0" r="32" fill="#1e293b" stroke="#334155" strokeWidth="1" fillOpacity="0.4" />

              {/* 4 Backward-Curved Impeller Vanes */}
              {[0, 90, 180, 270].map((angle) => (
                <path
                  key={angle}
                  d="M 0 0 C 10 5, 20 18, 28 24"
                  fill="none"
                  stroke={isCritical ? '#ef4444' : '#38bdf8'}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  transform={`rotate(${angle})`}
                />
              ))}

              {/* Center Hub Nut */}
              <circle cx="0" cy="0" r="6" fill="#38bdf8" />
              <circle cx="0" cy="0" r="2.5" fill="#0b0f17" />
            </g>

            {/* Suction Eye Perimeter */}
            <circle cx="0" cy="0" r="16" fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          </g>

          {/* Cavitation Vapor Bubbles & Shockwaves */}
          {running && (isMild || isModerate || isCritical) && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Incipient / Moderate Cavitation Bubbles */}
              {(isMild || isModerate) && (
                <>
                  <circle cx="140" cy="110" r="3.5" fill="#fde68a" opacity="0.85" style={{ animation: 'bubbleFloat 1.1s infinite ease-out' }} />
                  <circle cx="170" cy="115" r="3" fill="#ffffff" opacity="0.8" style={{ animation: 'bubbleFloat 1.3s infinite ease-out 0.3s' }} />
                  <circle cx="185" cy="135" r="3.2" fill="#fef08a" opacity="0.75" style={{ animation: 'bubbleFloat 1.0s infinite ease-out 0.6s' }} />
                </>
              )}

              {/* Severe Cavitation Vapor Cloud & Shock Collapse */}
              {isCritical && (
                <>
                  <ellipse cx="155" cy="123" rx="12" ry="10" fill="#ef4444" opacity="0.4" style={{ animation: 'severeShockwave 0.7s infinite ease-in-out' }} />
                  <circle cx="144" cy="95" r="4.5" fill="#ffffff" opacity="0.95" style={{ animation: 'bubbleFloat 0.7s infinite ease-out' }} />
                  <circle cx="156" cy="85" r="5" fill="#fecaca" opacity="0.9" style={{ animation: 'bubbleFloat 0.8s infinite ease-out 0.2s' }} />
                  <circle cx="175" cy="105" r="4" fill="#fee2e2" opacity="0.85" style={{ animation: 'bubbleFloat 0.9s infinite ease-out 0.4s' }} />
                  <circle cx="138" cy="135" r="4" fill="#ffffff" opacity="0.8" style={{ animation: 'bubbleFloat 0.7s infinite ease-out 0.5s' }} />
                </>
              )}
            </g>
          )}

          {/* Simple Directional Arrows */}
          <text x="32" y="118" fill="#64748b" fontSize="8" fontFamily="monospace">IN →</text>
          <text x="160" y="32" fill="#64748b" fontSize="8" fontFamily="monospace">↑ OUT</text>
        </svg>
      </div>

      {/* 3. Engineering Parameter Footer */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '4px',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        fontFamily: 'monospace'
      }}>
        <span>SPEED: <strong style={{ color: 'var(--text-primary)' }}>{currentRpm.toFixed(0)} RPM</strong></span>
        <span>VIBRATION: <strong style={{ color: currentVib >= 7.0 ? 'var(--status-critical)' : currentVib >= 4.5 ? 'var(--status-warning)' : 'var(--text-primary)' }}>{currentVib.toFixed(2)} mm/s</strong></span>
        <span>SEVERITY: <strong style={{ color: statusColor }}>{severity.toFixed(2)}</strong></span>
      </div>
    </div>
  );
};
