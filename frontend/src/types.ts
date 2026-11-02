export interface SensorReadings {
  suction_pressure: number | null;
  discharge_pressure: number | null;
  flow_rate: number | null;
  vibration_rms: number | null;
  temperature: number | null;
  rpm: number | null;
  motor_current?: number | null;
}

export interface SequenceFeatures {
  slope_suction: number;
  slope_vibration: number;
  slope_flow: number;
  slope_discharge: number;
  std_suction: number;
  std_vibration: number;
  suction_vapor_margin: number;
  head_diff: number;
  flow_deviation_pct: number;
}

export interface ModelPrediction {
  model_score: number;
  probability?: number;
  probabilities?: {
    normal: number;
    incipient: number;
    developing: number;
    severe: number;
  };
  predicted_class: string;
  predicted_class_idx?: number;
  risk_level: number;
  status: string;
  trajectory?: 'Stable' | 'Deteriorating' | 'Improving';
  risk_velocity_per_min?: number;
  model_version: string;
  sequence_features?: SequenceFeatures;
  attributions?: FeatureAttribution[];
}

export interface PredictionHistoryItem {
  sim_t: number;
  ts: string;
  model_score: number;
  probability?: number;
  predicted_class: string;
  risk_level: number;
  trajectory?: string;
  status?: string;
  vibration_rms?: number;
  suction_pressure?: number;
}

export interface ThresholdBreach {
  sensor: string;
  label?: string;
  level: 'warning' | 'alarm';
  value: number;
  limit: number;
  operator: string;
}

export interface PumpActuators {
  suction_restriction: number;
  bearing_wear: number;
  discharge_throttling: number;
  vibration_unbalance: number;
}

export interface LiveTelemetryMessage {
  type: 'reading' | 'snapshot';
  ts: string;
  sim_t: number;
  pump: string;
  scenario?: string;
  simulated: boolean;
  readings: SensorReadings;
  anomaly: 'spike' | 'dropout' | null;
  prediction: ModelPrediction | null;
  prediction_history?: PredictionHistoryItem[];
  status: string;
  data_error: string | null;
  model_error: string | null;
  threshold_breaches: ThresholdBreach[];
  active_alerts: number;
  running?: boolean;
  speed?: number;
  interval?: number;
  scenario_severity?: number;
  actuators?: PumpActuators;
  active_faults?: string[];
  phase?: string;
}

export interface AlertItem {
  id: number;
  ts: string;
  pump: string;
  source: string;
  category: string;
  severity: number;
  predicted_class: string | null;
  model_score: number | null;
  readings: string;
  explanation: string;
  action: string;
  status: 'active' | 'acknowledged' | 'resolved';
  ack_ts: string | null;
  resolved_ts: string | null;
  validation?: {
    classification: 'confirmed_cavitation' | 'false_positive' | 'missed_fault' | 'confirmed_normal';
    notes?: string;
    timestamp: string;
  };
}

export interface FeatureAttribution {
  feature: string;
  label?: string;
  value: number;
  unit: string;
  description?: string;
  score_change: number;
  normalized_deviation?: number;
  z_score?: number;
  baseline_mean?: number;
}

export interface ModelMetrics {
  version: string;
  model_type: string;
  accuracy: number;
  f1_macro: number;
  recall_cavitation: number;
  confusion_matrix: number[][];
  feature_importance: { feature: string; importance: number }[];
}

export interface RetrainingResult {
  candidate_version: string;
  timestamp: string;
  baseline_metrics: { accuracy: number; f1_macro: number; recall_cavitation: number };
  candidate_metrics: { accuracy: number; f1_macro: number; recall_cavitation: number };
  recommendation: 'deploy' | 'reject';
}
