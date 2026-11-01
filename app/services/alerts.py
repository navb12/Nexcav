"""Alert engine with industrial latching alarm logic.
Alerts remain visible and persistent while cavitation or threshold breaches exist,
and only resolve when explicitly acknowledged/resolved or when the pump has stably returned
to Normal Operation. Alerts provide engineering diagnostic recommendations.
"""
import json
from app.ml import registry
from app.ml.explain import explain
from app.services.scoring import CLASSES

SAFETY = " Operational Note: Verify physical instrumentation on-skid and adhere to site machinery protection limits."
MODEL_ACTIONS = {
    1: "Incipient Cavitation: Inspect inlet strainers, check suction liquid level and suction-side manual/actuated valves.",
    2: "Critical Cavitation Alarm: Depleted NPSHa margin. Throttle discharge valve or increase suction head to prevent catastrophic impeller destruction."
}
SENSOR_ACTIONS = {
    "vibration_rms": "Inspect overall broadband vibration trend (ISO 10816-3). Check for cavitation shockwave excitation and mechanical unbalance.",
    "suction_pressure": "Check suction-side restrictions, inlet pressure, strainer clogging, and suction vessel head.",
    "temperature": "Check drive-end bearing lubrication, operating duty point, and heat dissipation.",
    "flow_rate": "Review pump characteristic curve (Q-H) against current operating point; check for discharge throttling.",
    "discharge_pressure": "Inspect discharge non-return valves, header backpressure, and piping resistance."
}

class AlertEngine:
    def __init__(self):
        self.reset()

    def reset(self):
        self.streak = {}
        self.clear = {}
        self.cat = {}
        self.last_created = {}

    def evaluate(self, c, ts, sim_t, pump, reading, pred, breaches, data_error, risk):
        P = risk.get("persistence", 2)
        active = {}

        if data_error:
            active["data:error"] = dict(
                source="sensor", category="Hardware Signal Loss", severity=1, persist=1, score=None, cls=None,
                explanation=f"Sensor signal dropout: {data_error}",
                action="Check sensor 4-20mA loop, transducer power supply, and field wiring."
            )

        if pred and pred.get("risk_level", 0) >= 1:
            lv = pred["risk_level"]
            is_critical = (lv == 2)
            cat_name = "Critical Cavitation Alarm" if is_critical else "Incipient Cavitation Warning"
            text = f"Cavitation Index {pred['model_score'] * 100:.0f}%: " + (
                "Severe vapor cavity breakdown and collapse shockwaves." if is_critical
                else "Localized vapor bubble inception at impeller leading edges."
            )
            try:
                ex = explain(registry.get(), reading)
                text += " Key contributing sensors: " + "; ".join(f"{a['feature']} {a['value']:.2f} {a['unit']} ({a['score_change']:+.2f})" for a in ex["attributions"][:2]) + "."
            except Exception:
                pass

            active[f"model:{lv}"] = dict(
                source="model", category=cat_name, severity=lv, persist=P, score=pred["model_score"], cls=pred["predicted_class"],
                explanation=text, action=MODEL_ACTIONS.get(lv, "Review pump operating conditions.")
            )

        for b in breaches:
            level_name = "CRITICAL" if b["level"] == "alarm" else "WARNING"
            active[f"sensor:{b['sensor']}:{b['level']}"] = dict(
                source="sensor", category=f"Threshold Exceeded: {b['sensor']} ({level_name})",
                severity=2 if b["level"] == "alarm" else 1, persist=P, score=pred["model_score"] if pred else None, cls=pred["predicted_class"] if pred else None,
                explanation=f"{b['sensor']} = {b['value']:.2f} exceeded configured {b['level']} limit ({b['limit']:.2f}).",
                action=SENSOR_ACTIONS.get(b["sensor"], "Inspect pump parameters.")
            )

        created = []
        for k, a in active.items():
            self.streak[k] = self.streak.get(k, 0) + 1
            self.clear[k] = 0
            self.cat[k] = a["category"]
            if self.streak[k] < a["persist"]:
                continue

            row = c.execute("SELECT 1 FROM alerts WHERE pump=? AND category=? AND status!='resolved' LIMIT 1", (pump, a["category"])).fetchone()
            if row:
                continue

            if sim_t - self.last_created.get(k, -1e12) < risk.get("cooldown_s", 15.0):
                continue

            cur = c.execute(
                "INSERT INTO alerts(ts,pump,source,category,severity,predicted_class,model_score,readings,explanation,action,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (ts, pump, a["source"], a["category"], a["severity"], a["cls"], a["score"], json.dumps(dict(reading=reading, breaches=breaches)), a["explanation"], a["action"] + SAFETY, 'active')
            )
            self.last_created[k] = sim_t
            created.append(cur.lastrowid)

        # Latching resolution: Alerts ONLY auto-resolve when the pump is operating normally and clear for an extended period
        if not active:
            for k in list(self.streak):
                self.clear[k] = self.clear.get(k, 0) + 1
                if self.clear[k] >= 15:  # Require at least 15 stable clear ticks
                    c.execute("UPDATE alerts SET status='resolved', resolved_ts=? WHERE pump=? AND category=? AND status!='resolved'", (ts, pump, self.cat[k]))
                    for d in (self.streak, self.clear, self.cat):
                        d.pop(k, None)

        c.commit()
        return created

engine = AlertEngine()
