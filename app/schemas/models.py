from typing import Optional, Dict, Any, List, Literal
from pydantic import BaseModel, Field

class Reading(BaseModel):
    suction_pressure: Optional[float] = Field(None, ge=0.0, le=25.0)
    discharge_pressure: Optional[float] = Field(None, ge=0.0, le=50.0)
    flow_rate: Optional[float] = Field(None, ge=0.0, le=500.0)
    vibration_rms: Optional[float] = Field(None, ge=0.0, le=50.0)
    temperature: Optional[float] = Field(None, ge=-20.0, le=150.0)
    rpm: Optional[float] = Field(None, ge=0.0, le=6000.0)

class SimConfig(BaseModel):
    speed: float = Field(1.0, gt=0.0, le=100.0)
    interval: float = Field(1.0, gt=0.01, le=60.0)

class AnomalyReq(BaseModel):
    kind: Literal["spike", "dropout"]

class PumpConfig(BaseModel):
    id: str = "PUMP-01"
    name: str = "Primary Chilled Water Pump"
    nominal: Dict[str, float] = {
        "suction_pressure": 2.0,
        "discharge_pressure": 6.5,
        "flow_rate": 100.0,
        "vibration_rms": 2.0,
        "temperature": 55.0,
        "rpm": 2950.0
    }

class SimulationSettings(BaseModel):
    interval_s: float = 1.0
    speed: float = 1.0
    seed: int = 7

class RiskThresholds(BaseModel):
    score_low: float = 0.35
    score_high: float = 0.70
    persistence: int = 3
    cooldown_s: float = 15.0

class SensorLimit(BaseModel):
    warning: Optional[float] = None
    alarm: Optional[float] = None
    operator: Literal[">", "<"] = ">"

class RetentionSettings(BaseModel):
    max_readings: int = 20000
    max_alerts: int = 2000

class Settings(BaseModel):
    pump: PumpConfig = Field(default_factory=PumpConfig)
    simulation: SimulationSettings = Field(default_factory=SimulationSettings)
    risk: RiskThresholds = Field(default_factory=RiskThresholds)
    sensor_thresholds: Dict[str, Dict[str, Any]] = {
        "vibration_rms": {"warning": 4.5, "alarm": 7.0, "operator": ">"},
        "suction_pressure": {"warning": 1.2, "alarm": 0.8, "operator": "<"},
        "discharge_pressure": {"warning": 5.0, "alarm": 4.0, "operator": "<"},
        "temperature": {"warning": 75.0, "alarm": 85.0, "operator": ">"},
        "flow_rate": {"warning": 70.0, "alarm": 50.0, "operator": "<"}
    }
    retention: RetentionSettings = Field(default_factory=RetentionSettings)

class RetrainReq(BaseModel):
    drift: float = Field(0.0, ge=0.0, le=1.0)
    future_train_fraction: float = Field(0.2, gt=0.0, le=1.0)
    label_noise: float = Field(0.01, ge=0.0, le=0.5)

class DeployReq(BaseModel):
    version: str
    confirm: bool

class RollbackReq(BaseModel):
    version: str
    confirm: bool

