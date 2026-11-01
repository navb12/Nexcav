"""Alert engine: persistence (N consecutive ticks) -> create once; dedup while an unresolved alert of the same category exists;
cooldown (sim seconds) after creation; auto-resolve after N consecutive clear ticks. Alerts are diagnostic suggestions only."""
import json
from app.ml import registry
from app.ml.explain import explain
from app.services.scoring import CLASSES
SAFETY = " Diagnostic suggestion only: verify readings on site and follow site safety procedures."
MODEL_ACTIONS = {1: "Check suction-side restrictions and inlet pressure; review the pump operating point and flow rate.",
                 2: "Inspect strainers, valves and suction piping; verify liquid level and suction conditions; inspect vibration trends and mechanical condition; escalate for maintenance inspection if abnormal readings persist."}
SENSOR_ACTIONS = dict(vibration_rms="Inspect vibration trends and mechanical condition (alignment, bearings, balance) and check for cavitation noise.",
                      suction_pressure="Check suction-side restrictions, inlet pressure, strainers, valves and liquid level.",
                      temperature="Check cooling/lubrication, operating point and ambient conditions.",
                      flow_rate="Review pump operating point and flow rate; check for suction or discharge restrictions.")

class AlertEngine:
    def __init__(self): self.reset()
    def reset(self): self.streak = {}; self.clear = {}; self.cat = {}; self.last_created = {}

    def evaluate(self, c, ts, sim_t, pump, reading, pred, breaches, data_error, risk):
        P = risk["persistence"]; active = {}
        if data_error:
            active["data:error"] = dict(source="data", category="Sensor/Data Error", severity=1, persist=1, score=None, cls=None,
                                        explanation=f"Invalid or missing sensor data: {data_error}", action="Check sensor wiring, signal quality and data acquisition. Readings from this interval were not scored.")
        if pred and pred["risk_level"] >= 1:
            lv = pred["risk_level"]; text = f"Model score {pred['model_score']:.2f} (uncalibrated)."
            try:
                ex = explain(registry.get(), reading)
                text += " Largest model attributions: " + "; ".join(f"{a['feature']} {a['value']:.2f} {a['unit']} ({a['score_change']:+.2f})" for a in ex["attributions"][:2]) + ". Model attribution, not a confirmed physical fault."
            except Exception: pass
            active[f"model:{lv}"] = dict(source="model", category=CLASSES[lv], severity=lv, persist=P, score=pred["model_score"], cls=pred["predicted_class"], explanation=text, action=MODEL_ACTIONS[lv])
        for b in breaches:
            active[f"sensor:{b['sensor']}:{b['level']}"] = dict(source="sensor", category=f"Sensor threshold: {b['sensor']} ({b['level']})",
                severity=2 if b["level"] == "alarm" else 1, persist=P, score=pred["model_score"] if pred else None, cls=pred["predicted_class"] if pred else None,
                explanation=f"{b['sensor']} = {b['value']:.2f} crossed the configured {b['level']} limit {b['limit']:.2f}.", action=SENSOR_ACTIONS[b["sensor"]])
        created = []
        for k, a in active.items():
            self.streak[k] = self.streak.get(k, 0) + 1; self.clear[k] = 0; self.cat[k] = a["category"]
            if self.streak[k] < a["persist"]: continue
            if c.execute("SELECT 1 FROM alerts WHERE pump=? AND category=? AND status!='resolved' LIMIT 1", (pump, a["category"])).fetchone(): continue
            if sim_t - self.last_created.get(k, -1e12) < risk["cooldown_s"]: continue
            cur = c.execute("INSERT INTO alerts(ts,pump,source,category,severity,predicted_class,model_score,readings,explanation,action) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (ts, pump, a["source"], a["category"], a["severity"], a["cls"], a["score"], json.dumps(dict(reading=reading, breaches=breaches)), a["explanation"], a["action"] + SAFETY))
            self.last_created[k] = sim_t; created.append(cur.lastrowid)
        for k in list(self.streak):
            if k in active: continue
            self.clear[k] = self.clear.get(k, 0) + 1
            if self.clear[k] >= 2 * P:   # hysteresis: stay clear twice as long as the persistence window
                c.execute("UPDATE alerts SET status='resolved', resolved_ts=? WHERE pump=? AND category=? AND status!='resolved'", (ts, pump, self.cat[k]))
                for d in (self.streak, self.clear, self.cat): d.pop(k, None)
        c.commit(); return created
engine = AlertEngine()
