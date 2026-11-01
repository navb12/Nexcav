import React from 'react';

interface SensorCardProps {
  label: string;
  value: number | null;
  unit: string;
  nominal?: number;
  history?: number[];
  warningLimit?: number;
  alarmLimit?: number;
  operator?: '>' | '<';
  decimals?: number;
}

export const SensorCard: React.FC<SensorCardProps> = ({
  label,
  value,
  unit,
  nominal,
  history = [],
  warningLimit,
  alarmLimit,
  operator = '>',
  decimals = 2
}) => {
  const isMissing = value === null || value === undefined;

  let isCritical = false;
  let isWarning = false;

  if (!isMissing) {
    if (operator === '>') {
      if (alarmLimit !== undefined && value >= alarmLimit) isCritical = true;
      else if (warningLimit !== undefined && value >= warningLimit) isWarning = true;
    } else if (operator === '<') {
      if (alarmLimit !== undefined && value <= alarmLimit) isCritical = true;
      else if (warningLimit !== undefined && value <= warningLimit) isWarning = true;
    }
  }

  const statusColor = isMissing
    ? 'var(--text-muted)'
    : isCritical
    ? 'var(--status-critical)'
    : isWarning
    ? 'var(--status-warning)'
    : 'var(--status-normal)';

  const statusBg = isCritical
    ? 'rgba(239, 68, 68, 0.16)'
    : isWarning
    ? 'rgba(245, 158, 11, 0.16)'
    : 'rgba(16, 185, 129, 0.14)';

  const statusLabel = isMissing
    ? 'OFFLINE'
    : isCritical
    ? 'CRITICAL'
    : isWarning
    ? 'WARNING'
    : 'NORMAL';

  // Understandable Operating Range Context
  let thresholdText = '';
  if (isMissing) {
    thresholdText = 'Signal connection offline';
  } else if (isCritical) {
    thresholdText = alarmLimit !== undefined
      ? `Critical Limit Breached (${operator} ${alarmLimit} ${unit})`
      : 'Critical abnormal limit';
  } else if (isWarning) {
    thresholdText = warningLimit !== undefined
      ? `Warning Threshold Breached (${operator} ${warningLimit} ${unit})`
      : 'Warning threshold';
  } else {
    thresholdText = warningLimit !== undefined
      ? `Normal Operating Range (${operator === '<' ? '>' : '<'} ${warningLimit} ${unit})`
      : nominal !== undefined
      ? `Rated Nominal: ${nominal} ${unit}`
      : 'Within safe operating parameters';
  }

  // Subtle Secondary Micro-trend sparkline
  const sparkPoints = history.slice(-20);
  let sparklinePath = '';
  if (sparkPoints.length > 2) {
    const minVal = Math.min(...sparkPoints, (nominal ?? 10) * 0.85);
    const maxVal = Math.max(...sparkPoints, (nominal ?? 10) * 1.15, minVal + 0.05);
    const width = 72;
    const height = 22;

    const coords = sparkPoints.map((v, idx) => {
      const x = (idx / (sparkPoints.length - 1)) * width;
      const y = height - ((v - minVal) / (maxVal - minVal)) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    sparklinePath = `M ${coords.join(' L ')}`;
  }

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: `1px solid ${isCritical ? 'var(--status-critical)' : isWarning ? 'var(--status-warning)' : 'var(--border-subtle)'}`,
      borderRadius: '5px',
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      position: 'relative',
      overflow: 'hidden',
      minHeight: '80px',
      boxShadow: isCritical ? '0 0 12px rgba(239, 68, 68, 0.16)' : 'none'
    }}>
      {/* 1. Header: Readable Label & Prominent Status Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '0.2px'
        }}>
          {label}
        </span>

        {/* Status Indicator Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          backgroundColor: statusBg,
          color: statusColor,
          padding: '2px 7px',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: 800,
          fontFamily: 'monospace',
          letterSpacing: '0.4px'
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: statusColor
          }} />
          <span>{statusLabel}</span>
        </div>
      </div>

      {/* 2. Most Prominent Element: Big Reading with Unit & Subtle Sparkline */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        margin: '2px 0 1px'
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
          <span style={{
            fontSize: '26px',
            fontWeight: 800,
            color: isMissing ? 'var(--text-muted)' : isCritical ? 'var(--status-critical)' : isWarning ? 'var(--status-warning)' : '#ffffff',
            fontFamily: 'monospace',
            lineHeight: 1,
            letterSpacing: '-0.5px'
          }}>
            {isMissing ? '---' : value.toFixed(decimals)}
          </span>
          <span style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-secondary)'
          }}>
            {unit}
          </span>
        </div>

        {/* Subtle, Secondary Historical Trend Graph */}
        {sparklinePath && (
          <svg width="72" height="22" style={{ overflow: 'visible', opacity: 0.5 }}>
            <path
              d={sparklinePath}
              fill="none"
              stroke={statusColor}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* 3. Understandable Operating Threshold Status Line */}
      <div style={{
        fontSize: '11px',
        fontWeight: isCritical || isWarning ? 700 : 500,
        color: isCritical ? 'var(--status-critical)' : isWarning ? 'var(--status-warning)' : 'var(--text-muted)',
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: '3px',
        marginTop: '1px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {thresholdText}
      </div>
    </div>
  );
};
