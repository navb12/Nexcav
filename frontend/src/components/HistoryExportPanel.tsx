import React, { useState } from 'react';
import { AlertItem } from '../types.ts';

interface HistoryPanelProps {
  alerts: AlertItem[];
  onAcknowledgeAlert: (id: number) => void;
  onResolveAlert: (id: number) => void;
  onExportCsv: () => void;
  onClearData: () => Promise<void>;
  onRefreshAlerts: () => void;
}

export const HistoryExportPanel: React.FC<HistoryPanelProps> = ({
  alerts,
  onAcknowledgeAlert,
  onResolveAlert,
  onExportCsv,
  onClearData,
  onRefreshAlerts
}) => {
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');

  const handleClear = async () => {
    if (!window.confirm('Clear all logged sensor history and alerts from the database?')) return;
    setClearing(true);
    try {
      await onClearData();
      setClearMsg('Historical database logs reset.');
      setTimeout(() => setClearMsg(''), 4000);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Historical CSV Export Bar */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onExportCsv}
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              color: 'var(--accent-teal)',
              border: '1px solid var(--border-medium)',
              padding: '5px 12px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Download CSV Telemetry
          </button>
        </div>

        <button
          onClick={handleClear}
          disabled={clearing}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-subtle)',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: clearing ? 'not-allowed' : 'pointer'
          }}
        >
          {clearing ? 'Clearing...' : 'Clear Demo Database'}
        </button>
      </div>

      {clearMsg && (
        <div style={{ fontSize: '11px', color: 'var(--status-normal)', padding: '0 4px' }}>
          ✓ {clearMsg}
        </div>
      )}

      {/* Historical Diagnostics & Alerts List */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Historical Diagnostic Events & Threshold Alerts
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Persistence-verified alerts and diagnostic suggestions
            </span>
          </div>

          <button
            onClick={onRefreshAlerts}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>

        {alerts.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-surface-subtle)',
            borderRadius: '6px',
            border: '1px dashed var(--border-subtle)'
          }}>
            No diagnostic events recorded in the database.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
            {alerts.map((a) => {
              const isResolved = a.status === 'resolved';
              const isCritical = a.severity === 2;
              const accentColor = isResolved 
                ? 'var(--border-subtle)' 
                : isCritical 
                ? 'var(--status-critical)' 
                : 'var(--status-warning)';

              return (
                <div
                  key={a.id}
                  style={{
                    backgroundColor: 'var(--bg-surface-subtle)',
                    border: `1px solid var(--border-subtle)`,
                    borderLeft: `3px solid ${accentColor}`,
                    borderRadius: '4px',
                    padding: '10px 12px',
                    opacity: isResolved ? 0.5 : 1
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '9px',
                        fontFamily: 'monospace',
                        textTransform: 'uppercase',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        color: accentColor,
                        fontWeight: 600
                      }}>
                        {a.source} · Sev {a.severity}
                      </span>
                      <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                        {a.category}
                      </strong>
                    </div>

                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {a.ts.split('T')[1]?.slice(0, 8) || a.ts}
                    </span>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '4px 0' }}>
                    {a.explanation}
                  </p>

                  <div style={{
                    fontSize: '10px',
                    color: 'var(--accent-teal)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    margin: '6px 0 4px'
                  }}>
                    <strong style={{ color: 'var(--text-muted)' }}>Action: </strong>
                    {a.action}
                  </div>

                  {!isResolved && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
                      {a.status !== 'acknowledged' && (
                        <button
                          onClick={() => onAcknowledgeAlert(a.id)}
                          style={{
                            backgroundColor: 'transparent',
                            color: 'var(--status-warning)',
                            border: '1px solid var(--border-subtle)',
                            padding: '2px 8px',
                            borderRadius: '3px',
                            fontSize: '10px',
                            cursor: 'pointer'
                          }}
                        >
                          Ack
                        </button>
                      )}
                      <button
                        onClick={() => onResolveAlert(a.id)}
                        style={{
                          backgroundColor: 'transparent',
                          color: 'var(--status-normal)',
                          border: '1px solid var(--border-subtle)',
                          padding: '2px 8px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
