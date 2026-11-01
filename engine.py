"""Synthetic pump sensor simulator (SIMULATED data; plausible, correlated, NOT a physical pump model).
A latent severity `sev` (0 normal .. 2 severe) moves toward the scenario target at a limited rate, so scenario
changes are smooth. Low suction, flow instability, discharge fluctuation and vibration share a transient term,
so they move together. Units: bar abs, m3/h, mm/s RMS, degC, rpm."""
import copy, math
import numpy as np
SCENARIOS = ["normal", "developing", "severe", "custom"]
RAW = ["suction_pressure", "discharge_pressure", "flow_rate", "vibration_rms", "temperature", "rpm"]
TARGET = {"normal": (0.0, 0.1), "developing": (1.2, 1 / 60), "severe": (2.0, 0.1)}  # (target sev, max rise per tick)

class Sim:
    def __init__(self):
        self.running = False; self.speed = 1.0; self.interval = 1.0; self.pump_id = "PUMP-01"; self.pump_name = ""
        self.seed = 7; self.pending_anomaly = None
        self.nominal = dict(suction_pressure=2.0, discharge_pressure=6.5, flow_rate=100.0, vibration_rms=2.0, temperature=55.0, rpm=2950.0)
        self.reset_state()
    def reset_state(self):
        self.scenario = "normal"; self.tick = 0; self.sim_t = 0.0; self.sev = 0.0; self.last = None
        self.rng = np.random.default_rng(self.seed); self.custom = dict(self.nominal)
    def apply_settings(self, cfg):
        self.interval = cfg["simulation"]["interval_s"]; self.speed = cfg["simulation"]["speed"]
        self.pump_id = cfg["pump"]["id"]; self.pump_name = cfg["pump"]["name"]
        self.nominal = {k: float(v) for k, v in cfg["pump"]["nominal"].items()}
        if cfg["simulation"]["seed"] != self.seed: self.seed = cfg["simulation"]["seed"]
sim = Sim()

def step_severity(s):
    if s.scenario == "custom": return
    tgt, up = TARGET[s.scenario]
    s.sev += float(np.clip(tgt - s.sev, -0.1, up))

def generate(s):
    """Return (reading dict, anomaly kind or None). A dropout sets one sensor to None (missing)."""
    r, t, n = s.rng, s.tick, s.nominal
    if s.scenario == "custom":
        d = {k: float(v + r.normal(0, abs(v) * .01 + 1e-3)) for k, v in s.custom.items()}
    else:
        sev, z = s.sev, float(r.normal())              # z = shared transient (pressure/flow/vibration co-fluctuation)
        flow = n["flow_rate"] - 4 * sev + r.normal(0, 2 + 4 * sev) + 3 * math.sin(t / 8) + 2.0 * sev * z
        d = dict(suction_pressure=n["suction_pressure"] - .55 * sev + r.normal(0, .08 + .12 * sev),
                 flow_rate=flow, rpm=n["rpm"] + r.normal(0, 8),
                 discharge_pressure=n["discharge_pressure"] - .004 * (flow - n["flow_rate"]) + r.normal(0, .05 + .12 * sev) + .1 * sev * z,
                 vibration_rms=max(.2, n["vibration_rms"] + 1.3 * sev + r.normal(0, .25 + .35 * sev) + .4 * sev * z),
                 temperature=n["temperature"] + 2 * sev + r.normal(0, .6))
        d = {k: float(d[k]) for k in RAW}
    anomaly = s.pending_anomaly; s.pending_anomaly = None
    if anomaly is None:
        u = r.random(); anomaly = "spike" if u < .01 else "dropout" if u < .015 else None
    if anomaly == "spike": d["vibration_rms"] += 6.0
    elif anomaly == "dropout": d[RAW[int(r.integers(0, len(RAW)))]] = None
    return d, anomaly
