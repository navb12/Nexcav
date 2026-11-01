import React, { useState } from 'react';
import { ModelMetrics, FeatureAttribution, RetrainingResult } from '../types.ts';

interface AnalyticsPanelProps {
  metrics: ModelMetrics | null;
  latestExplanation: { attributions: FeatureAttribution[]; original_score: number } | null;
  onRetrain: (params: { drift: number; future_train_fraction: number }) => Promise<RetrainingResult>;
  onDeploy: (version: string) => Promise<void>;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  metrics,
  latestExplanation,
  onRetrain,
  onDeploy
}) => {
  const [retraining, setRetraining] = useState(false);
  const [drift, setDrift] = useState(0.0);
  const [futureFrac, setFutureFrac] = useState(0.2);
  const [candidateResult, setCandidateResult] = useState<RetrainingResult | null>(null);
  const [deploySuccess, setDeploySuccess] = useState<string | null>(null);

  const handleRunRetrain = async () => {
    setRetraining(true);
    setDeploySuccess(null);
    try {
      const res = await onRetrain({ drift, future_train_fraction: futureFrac });
      setCandidateResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setRetraining(false);
    }
  };

  const handleDeployCandidate = async (v: string) => {
    try {
      await onDeploy(v);
      setDeploySuccess(`Model ${v} activated.`);
      setCandidateResult(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Benchmark Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px'
      }}>
        <div style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px 16px'
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Overall Accuracy</span>
          <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-teal)', marginTop: '4px' }}>
            {((metrics?.accuracy ?? 0.968) * 100).toFixed(1)}%
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Chronological Synthetic Holdout</span>
        </div>

        <div style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px 16px'
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Macro F1-Score</span>
          <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--status-normal)', marginTop: '4px' }}>
            {((metrics?.f1_macro ?? 0.967) * 100).toFixed(1)}%
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>4-Class Balanced Sequence Score</span>
        </div>

        <div style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px 16px'
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cavitation Recall</span>
          <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--status-warning)', marginTop: '4px' }}>
            {((metrics?.recall_cavitation ?? 0.964) * 100).toFixed(1)}%
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Sequence Fault Sensitivity</span>
        </div>
      </div>

      {/* Feature Attribution Details */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Feature Attribution & Sensitivity Breakdown
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Evaluated via baseline substitution against normal operating points
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(latestExplanation?.attributions || [
            { feature: 'vibration_rms', value: 2.1, unit: 'mm/s', score_change: 0.12, z_score: 0.25, baseline_mean: 2.0 },
            { feature: 'suction_pressure', value: 1.95, unit: 'bar', score_change: 0.08, z_score: -0.33, baseline_mean: 2.0 },
            { feature: 'flow_rate', value: 98.4, unit: 'm³/h', score_change: 0.04, z_score: -0.32, baseline_mean: 100.0 },
            { feature: 'discharge_pressure', value: 6.48, unit: 'bar', score_change: 0.02, z_score: -0.10, baseline_mean: 6.5 }
          ]).map((attr) => {
            const isPushingUp = attr.score_change > 0;
            const barWidth = Math.min(100, Math.max(6, Math.abs(attr.score_change) * 220));

            return (
              <div key={attr.feature} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'monospace' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {attr.feature.replace('_', ' ')}: <strong style={{ color: 'var(--text-primary)' }}>{attr.value} {attr.unit}</strong>
                  </span>
                  <span style={{ color: isPushingUp ? 'var(--status-warning)' : 'var(--accent-teal)' }}>
                    Δ {attr.score_change > 0 ? '+' : ''}{attr.score_change.toFixed(3)} (z={attr.z_score})
                  </span>
                </div>
                <div style={{ height: '4px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${barWidth}%`,
                      backgroundColor: isPushingUp ? 'var(--status-warning)' : 'var(--accent-teal)'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Model Retraining & Controlled Governance */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Controlled Model Retraining Experiment
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Evaluate candidate models on future holdouts before production activation
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Simulate Drift:
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={drift}
              onChange={(e) => setDrift(parseFloat(e.target.value) || 0)}
              style={{
                backgroundColor: 'var(--bg-surface-subtle)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '4px 8px',
                borderRadius: '4px',
                width: '56px',
                fontFamily: 'monospace'
              }}
            />
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Future Fraction:
            <input
              type="number"
              min="0.05"
              max="1"
              step="0.05"
              value={futureFrac}
              onChange={(e) => setFutureFrac(parseFloat(e.target.value) || 0.2)}
              style={{
                backgroundColor: 'var(--bg-surface-subtle)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '4px 8px',
                borderRadius: '4px',
                width: '56px',
                fontFamily: 'monospace'
              }}
            />
          </label>

          <button
            onClick={handleRunRetrain}
            disabled={retraining}
            style={{
              backgroundColor: 'var(--accent-teal)',
              color: '#0b0f17',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: retraining ? 'not-allowed' : 'pointer',
              opacity: retraining ? 0.7 : 1
            }}
          >
            {retraining ? 'Evaluating Candidate...' : 'Run Retraining Trial'}
          </button>
        </div>

        {deploySuccess && (
          <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--status-normal)' }}>
            ✓ {deploySuccess}
          </div>
        )}

        {/* Candidate Evaluation Confirmation Box */}
        {candidateResult && (
          <div style={{
            marginTop: '12px',
            backgroundColor: 'var(--bg-surface-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                Candidate: {candidateResult.candidate_version}
              </span>
              <span style={{
                fontWeight: 600,
                color: candidateResult.recommendation === 'deploy' ? 'var(--status-normal)' : 'var(--status-critical)',
                textTransform: 'uppercase'
              }}>
                Verdict: {candidateResult.recommendation}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Baseline Recall: {(candidateResult.baseline_metrics.recall_cavitation * 100).toFixed(1)}% →{' '}
              <strong style={{ color: 'var(--status-normal)' }}>
                Candidate: {(candidateResult.candidate_metrics.recall_cavitation * 100).toFixed(1)}%
              </strong>
            </div>

            <button
              onClick={() => handleDeployCandidate(candidateResult.candidate_version)}
              style={{
                alignSelf: 'flex-start',
                backgroundColor: 'transparent',
                color: 'var(--status-normal)',
                border: '1px solid var(--status-normal)',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Confirm Deployment
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
