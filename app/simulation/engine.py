"""Synthetic pump sensor simulator (Industrial physical parameters).
Provides 4 distinct operational scenarios:
- normal: Normal Operation (NPSHa >> NPSHr)
- mild: Mild Cavitation (Incipient bubbles at vane tips)
- moderate: Moderate Cavitation (Vapor pockets expanding, head loss)
- severe: Severe Cavitation (Full vapor breakdown, intense shockwave vibration)
Units: bar abs, m3/h, mm/s RMS, degC, rpm.
"""
import copy, math
try:
    import numpy as np
except ImportError:
    import random
    class FallbackRNG:
        def __init__(self, seed=42):
            self.r = random.Random(seed)
        def normal(self, loc=0.0, scale=1.0):
            return self.r.gauss(loc, scale)
        def random(self):
            return self.r.random()
        def integers(self, low, high):
            return self.r.randint(low, high - 1)
    class FallbackNP:
        @staticmethod
        def clip(val, a_min, a_max):
            return max(a_min, min(val, a_max))
        @staticmethod
        def default_rng(seed=42):
            return FallbackRNG(seed)
    np = FallbackNP

SCENARIOS = ["normal", "mild", "moderate", "severe", "developing", "custom"]
RAW = ["suction_pressure", "discharge_pressure", "flow_rate", "vibration_rms", "temperature", "rpm"]

SCENARIO_TARGETS = {
    "normal": {"sev": 0.05, "suction": 2.05, "discharge": 6.52, "flow": 100.2, "vib": 1.85, "temp": 52.5, "rpm": 2950},
    "mild": {"sev": 0.65, "suction": 1.42, "discharge": 6.25, "flow": 94.8, "vib": 3.65, "temp": 55.8, "rpm": 2948},
    "developing": {"sev": 0.65, "suction": 1.42, "discharge": 6.25, "flow": 94.8, "vib": 3.65, "temp": 55.8, "rpm": 2948},
    "moderate": {"sev": 1.35, "suction": 1.05, "discharge": 5.65, "flow": 85.5, "vib": 5.45, "temp": 62.2, "rpm": 2942},
    "severe": {"sev": 2.00, "suction": 0.62, "discharge": 4.35, "flow": 71.8, "vib": 8.35, "temp": 72.5, "rpm": 2930}
}

class Sim:
    def __init__(self):
        self.running = False
        self.speed = 1.0
        self.interval = 1.0
        self.pump_id = "PUMP-01"
        self.pump_name = "Primary Process Centrifugal Pump"
        self.seed = 42
        self.pending_anomaly = None
        self.nominal = dict(suction_pressure=2.05, discharge_pressure=6.52, flow_rate=100.2, vibration_rms=1.85, temperature=52.5, rpm=2950.0)
        self.reset_state()

    def reset_state(self):
        self.scenario = "normal"
        self.tick = 0
        self.sim_t = 0.0
        self.sev = 0.05
        self.last = None
        self.rng = np.default_rng(self.seed)
        self.custom = dict(self.nominal)

    def apply_settings(self, cfg):
        self.interval = cfg["simulation"]["interval_s"]
        self.speed = cfg["simulation"]["speed"]
        self.pump_id = cfg["pump"]["id"]
        self.pump_name = cfg["pump"]["name"]
        self.nominal = {k: float(v) for k, v in cfg["pump"]["nominal"].items()}
        if cfg["simulation"]["seed"] != self.seed:
            self.seed = cfg["simulation"]["seed"]

sim = Sim()

def step_severity(s):
    if s.scenario == "custom":
        return
    tgt = SCENARIO_TARGETS.get(s.scenario, SCENARIO_TARGETS["normal"])["sev"]
    diff = tgt - s.sev
    s.sev += float(np.clip(diff, -0.25, 0.25))

def generate(s):
    r, t = s.rng, s.tick
    cfg = SCENARIO_TARGETS.get(s.scenario, SCENARIO_TARGETS["normal"])

    if s.scenario == "custom":
        d = {k: float(v + r.normal(0, abs(v) * .01 + 1e-3)) for k, v in s.custom.items()}
    else:
        z = float(r.normal())
        suction = cfg["suction"] + r.normal(0, 0.02) - 0.01 * math.sin(t / 6)
        discharge = cfg["discharge"] + r.normal(0, 0.035) + 0.02 * z
        flow = cfg["flow"] + r.normal(0, 0.8) + 0.5 * math.sin(t / 8) + 0.3 * z
        vib = max(0.4, cfg["vib"] + r.normal(0, 0.15) + 0.15 * s.sev * z)
        temp = cfg["temp"] + r.normal(0, 0.3)
        rpm = cfg["rpm"] + r.normal(0, 5)

        d = dict(
            suction_pressure=round(float(suction), 2),
            discharge_pressure=round(float(discharge), 2),
            flow_rate=round(float(flow), 1),
            vibration_rms=round(float(vib), 2),
            temperature=round(float(temp), 1),
            rpm=round(float(rpm), 0)
        )

    anomaly = s.pending_anomaly
    s.pending_anomaly = None

    if anomaly == "spike":
        d["vibration_rms"] += 6.5
    elif anomaly == "dropout":
        d[RAW[int(r.integers(0, len(RAW)))]] = None

    return d, anomaly
