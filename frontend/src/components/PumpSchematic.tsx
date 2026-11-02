import React from 'react';

interface PumpSchematicProps {
  rpm?: number;
  running?: boolean;
  probability?: number;
  severityStage?: 'Normal' | 'Incipient' | 'Developed' | 'Severe';
  hasCavitation?: boolean;
}

export const PumpSchematic: React.FC<PumpSchematicProps> = ({
  running = true,
  probability = 0.05,
  severityStage = 'Normal'
}) => {
  // Constant smooth impeller rotation speed (perfectly calm and steady)
  const spinSpeed = running ? 2.4 : 0;

  // Scale bubbles with severity: none at Normal, 2 at Incipient, 4 at Developed, 6 at Severe
  let bubbleCount = 0;
  if (severityStage === 'Severe' || probability >= 0.80) {
    bubbleCount = 6;
  } else if (severityStage === 'Developed' || probability >= 0.50) {
    bubbleCount = 4;
  } else if (severityStage === 'Incipient' || probability >= 0.25) {
    bubbleCount = 2;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '180px',
        position: 'relative'
      }}
    >
      <svg
        viewBox="0 0 240 180"
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        <defs>
          <style>{`
            @keyframes schematicSpin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            @keyframes bubbleFlowLeft {
              0% { transform: translateX(0); opacity: 0; }
              20% { opacity: 0.9; }
              80% { opacity: 0.9; }
              100% { transform: translateX(65px); opacity: 0; }
            }
          `}</style>
        </defs>

        {/* Pump Assembly (Completely stationary, zero shake or jitter) */}
        <g>
          {/* 1. Suction Inlet Pipe (Horizontal on Left) */}
          <rect
            x="10"
            y="85"
            width="75"
            height="16"
            rx="1"
            fill="#334155"
            stroke="#475569"
            strokeWidth="1.2"
          />
          {/* Flange ring */}
          <rect
            x="8"
            y="82"
            width="5"
            height="22"
            rx="1"
            fill="#475569"
          />
          {/* Suction Label */}
          <text
            x="26"
            y="118"
            fill="#64748b"
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            fontWeight="500"
          >
            Suction
          </text>

          {/* Animated Blue Cavitation Bubbles flowing into Impeller Eye scaled with severity */}
          {running && bubbleCount > 0 && (
            <g style={{ transform: 'translate(15px, 93px)' }}>
              {bubbleCount >= 2 && (
                <>
                  <circle cx="0" cy="-10" r="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear' }} />
                  <circle cx="15" cy="-6" r="3.5" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear 0.3s' }} />
                </>
              )}
              {bubbleCount >= 4 && (
                <>
                  <circle cx="30" cy="-14" r="3" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear 0.6s' }} />
                  <circle cx="45" cy="-8" r="3.5" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear 0.9s' }} />
                </>
              )}
              {bubbleCount >= 6 && (
                <>
                  <circle cx="22" cy="-12" r="2.5" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear 0.45s' }} />
                  <circle cx="38" cy="-5" r="4" fill="none" stroke="#38bdf8" strokeWidth="1.5" style={{ animation: 'bubbleFlowLeft 1.2s infinite linear 0.75s' }} />
                </>
              )}
            </g>
          )}

          {/* 2. Discharge Outlet Pipe & Nozzle (Vertical on Top Right) */}
          <rect
            x="138"
            y="14"
            width="16"
            height="60"
            rx="1"
            fill="#475569"
            stroke="#64748b"
            strokeWidth="1.2"
          />
          {/* Gray nozzle bar / flange */}
          <rect
            x="134"
            y="12"
            width="24"
            height="6"
            rx="1"
            fill="#64748b"
          />
          {/* Discharge Label */}
          <text
            x="160"
            y="28"
            fill="#64748b"
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            fontWeight="500"
          >
            Discharge
          </text>

          {/* 3. Circular Volute Casing (Neutral 1px border) */}
          <circle
            cx="120"
            cy="93"
            r="48"
            fill="#111827"
            stroke="#cbd5e1"
            strokeWidth="1.8"
          />

          {/* 4. Center Impeller Eye Hub and 3 Curved White Vanes */}
          <g
            style={{
              transformOrigin: '120px 93px',
              animation: running ? `schematicSpin ${spinSpeed}s infinite linear` : 'none'
            }}
          >
            {/* Vane 1 (pointing upwards) */}
            <path
              d="M 120 93 Q 128 72, 136 56"
              stroke="#ffffff"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Vane 2 (pointing bottom-right ~120 deg) */}
            <path
              d="M 120 93 Q 140 106, 153 124"
              stroke="#ffffff"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Vane 3 (pointing bottom-left ~240 deg) */}
            <path
              d="M 120 93 Q 102 108, 88 116"
              stroke="#ffffff"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />

            {/* Center Hub */}
            <circle
              cx="120"
              cy="93"
              r="8"
              fill="#e2e8f0"
            />
            <circle
              cx="120"
              cy="93"
              r="3"
              fill="#0f172a"
            />
          </g>
        </g>
      </svg>
    </div>
  );
};
