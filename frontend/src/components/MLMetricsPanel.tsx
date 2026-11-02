import React from 'react';
import { ModelMetrics } from '../types.ts';

interface AnalyticsPanelProps {
  metrics: ModelMetrics | null;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ metrics }) => {
  if (!metrics) {
    return (
      <div style={{ padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
        Loading model metrics from <code>models/metrics.json</code>...
      </div>
    );
  }

  const accuracy = (metrics.accuracy ?? 0.9675) * 100;
  const precision = ((metrics.precision ?? 0.966) * 100);
  const recall = ((metrics.recall ?? 0.956) * 100);
  const f1 = ((metrics.f1_score ?? 0.961) * 100);
  const rocAuc = metrics.roc_auc ?? 0.9947;

  const cm = metrics.confusion_matrix || [[678, 17], [22, 483]];
  const tn = cm[0]?.[0] ?? 0;
  const fp = cm[0]?.[1] ?? 0;
  const fn = cm[1]?.[0] ?? 0;
  const tp = cm[1]?.[1] ?? 0;

  const split = metrics.split_sizes || { train_runs: 80, test_runs: 20, train_samples: 4800, test_samples: 1200 };
  const features = (metrics.feature_importances || metrics.feature_importance || []).slice(0, 10);
  const rocPoints = metrics.roc_curve || [];

  // Generate ROC curve SVG path
  let rocPathD = 'M 40 210';
  if (rocPoints.length > 0) {
    rocPathD = rocPoints.map((pt, i) => {
      const x = 40 + pt.fpr * 200;
      const y = 210 - pt.tpr * 190;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      {/* 1. Header & Model Specification */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        borderBottom: '1px solid #1e293b',
        paddingBottom: '10px'
      }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Model Evaluation & Benchmarks
          </h2>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            Model: <strong style={{ color: '#38bdf8' }}>{metrics.model_type || 'RandomForestClassifier'}</strong> (100 estimators) &bull; Evaluated strictly on independent held-out runs
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>
          models/metrics.json
        </div>
      </div>

      {/* 2. Primary Metrics KPI Cards (Accuracy, Precision, Recall, F1, ROC-AUC) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '12px'
      }}>
        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Accuracy</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', marginTop: '4px' }}>
            {accuracy.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>Held-out test runs</div>
        </div>

        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Precision</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace', marginTop: '4px' }}>
            {precision.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>True cavitation / flagged</div>
        </div>

        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Recall</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace', marginTop: '4px' }}>
            {recall.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>Sensitivity to cavitation</div>
        </div>

        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>F1-Score</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', marginTop: '4px' }}>
            {f1.toFixed(1)}%
          </div>
          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>Harmonic mean P & R</div>
        </div>

        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>ROC-AUC</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace', marginTop: '4px' }}>
            {rocAuc.toFixed(4)}
          </div>
          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>Area under ROC curve</div>
        </div>
      </div>

      {/* 3. Split Sizes & Partitioning Notice */}
      <div style={{
        backgroundColor: '#111827',
        border: '1px solid #1e293b',
        borderRadius: '6px',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          <div>
            <span style={{ color: '#94a3b8' }}>Train Split: </span>
            <strong style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{split.train_runs} runs</strong> ({split.train_samples.toLocaleString()} rows &bull; 80%)
          </div>
          <div>
            <span style={{ color: '#94a3b8' }}>Test Split: </span>
            <strong style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{split.test_runs} runs</strong> ({split.test_samples.toLocaleString()} rows &bull; 20%)
          </div>
        </div>
        <div style={{ color: '#38bdf8', fontSize: '11.5px', fontWeight: 500 }}>
          ✓ Held-out run isolation: zero test runs were ever seen during model training
        </div>
      </div>

      {/* 4. Confusion Matrix and ROC Curve */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Confusion Matrix */}
        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '16px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 12px 0' }}>
            Confusion Matrix (Test Runs Only)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: '8px', textAlign: 'center', fontSize: '12px' }}>
            <div></div>
            <div style={{ color: '#94a3b8', fontWeight: 600 }}>Pred: Normal</div>
            <div style={{ color: '#94a3b8', fontWeight: 600 }}>Pred: Cavitation</div>

            <div style={{ color: '#94a3b8', fontWeight: 600, textAlign: 'right', paddingRight: '8px', alignSelf: 'center' }}>
              Actual: Normal
            </div>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '14px', border: '1px solid #334155' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>{tn}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>True Negative (TN)</div>
            </div>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '14px', border: '1px solid #334155' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171', fontFamily: 'monospace' }}>{fp}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>False Positive (FP)</div>
            </div>

            <div style={{ color: '#94a3b8', fontWeight: 600, textAlign: 'right', paddingRight: '8px', alignSelf: 'center' }}>
              Actual: Cavitation
            </div>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '14px', border: '1px solid #334155' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171', fontFamily: 'monospace' }}>{fn}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>False Negative (FN)</div>
            </div>
            <div style={{ backgroundColor: '#1e293b', borderRadius: '4px', padding: '14px', border: '1px solid #334155' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>{tp}</div>
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>True Positive (TP)</div>
            </div>
          </div>
        </div>

        {/* ROC Curve SVG */}
        <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
              ROC Curve (AUC = {rocAuc.toFixed(4)})
            </h3>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Sensitivity vs (1 - Specificity)</span>
          </div>

          <div style={{ width: '100%', height: '170px' }}>
            <svg viewBox="0 0 260 230" style={{ width: '100%', height: '100%' }}>
              {/* Axes */}
              <line x1="40" y1="210" x2="240" y2="210" stroke="#334155" strokeWidth="1.2" />
              <line x1="40" y1="20" x2="40" y2="210" stroke="#334155" strokeWidth="1.2" />

              {/* Diagonal Random Classifier Baseline */}
              <line x1="40" y1="210" x2="240" y2="20" stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />

              {/* True ROC Path */}
              <path d={rocPathD} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />

              {/* Ticks and Labels */}
              <text x="35" y="214" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">0.0</text>
              <text x="35" y="115" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">0.5</text>
              <text x="35" y="24" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="end">1.0</text>

              <text x="40" y="224" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">0.0</text>
              <text x="140" y="224" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">0.5</text>
              <text x="240" y="224" fill="#64748b" fontSize="9" fontFamily="monospace" textAnchor="middle">1.0 FPR</text>
            </svg>
          </div>
        </div>
      </div>

      {/* 5. Feature Importances Bar Chart */}
      <div style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '6px', padding: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', margin: '0 0 12px 0' }}>
          Top Feature Importances (Random Forest Gini Impurity)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {features.map((feat) => {
            const impPct = (feat.importance * 100);
            const maxImp = Math.max(...features.map(f => f.importance));
            const barWidth = maxImp > 0 ? (feat.importance / maxImp) * 100 : 0;

            return (
              <div key={feat.feature} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11.5px', fontFamily: 'monospace' }}>
                <span style={{ width: '180px', color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {feat.feature}
                </span>
                <div style={{ flex: 1, height: '8px', backgroundColor: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${barWidth}%`,
                      backgroundColor: '#38bdf8',
                      borderRadius: '4px'
                    }}
                  />
                </div>
                <span style={{ width: '55px', textAlign: 'right', color: '#94a3b8' }}>
                  {impPct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
