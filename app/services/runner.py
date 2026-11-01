import asyncio
import datetime as dt
import logging
from pydantic import ValidationError
from app.database import db
from app.schemas.models import Reading
from app.services import config
from app.services.alerts import engine
from app.services.scoring import score, threshold_breaches, ModelUnavailable
from app.simulation.engine import sim, generate, step_severity, RAW

log = logging.getLogger("pumpguard.runner")
CLIENTS: set = set()

def now():
    return dt.datetime.now().isoformat(timespec="milliseconds")

def process_tick(c):
    """One simulation step: generate -> validate -> ML score -> persist -> alerts. Returns the message broadcast over WebSocket."""
    cfg = config.get()
    sim.tick += 1
    sim.sim_t += sim.interval
    step_severity(sim)
    
    d, anomaly = generate(sim)
    ts = now()
    err = None
    pred = None
    
    try:
        Reading(**d)
    except ValidationError as e:
        err = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" if x['loc'] else x['msg'] for x in e.errors())
        
    model_err = None
    if err is None:
        try:
            pred = score(d, cfg.get("risk", {}))
        except ModelUnavailable as e:
            model_err = str(e)
            
    status = pred["status"] if pred else ("Sensor/Data Error" if err else "Model Unavailable")
    breaches = threshold_breaches(d, cfg.get("sensor_thresholds", {}))
    
    c.execute(
        """INSERT INTO readings(ts,sim_t,pump,scenario,suction_pressure,discharge_pressure,flow_rate,vibration_rms,temperature,rpm,predicted_class,risk_level,model_score,status,model_version,anomaly)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ts, sim.sim_t, sim.pump_id, sim.scenario, *[d[k] for k in RAW],
         pred and pred["predicted_class"], pred and pred["risk_level"],
         pred and pred["model_score"], status, pred and pred["model_version"], anomaly)
    )
    if anomaly:
        db.log_event(c, ts, sim.pump_id, "sensor_anomaly", anomaly)
        
    if model_err is None:
        engine.evaluate(c, ts, sim.sim_t, sim.pump_id, d, pred, breaches, err, cfg.get("risk", {}))
        
    c.commit()
    
    if sim.tick % 200 == 0:
        retention = cfg.get("retention", {})
        db.cleanup(c, retention.get("max_readings", 20000), retention.get("max_alerts", 2000))
        
    active_row = c.execute("SELECT COUNT(*) FROM alerts WHERE pump=? AND status!='resolved'", (sim.pump_id,)).fetchone()
    active = active_row[0] if active_row else 0
    
    msg = dict(
        type="reading", ts=ts, sim_t=sim.sim_t, pump=sim.pump_id, scenario=sim.scenario,
        simulated=True, readings=d, anomaly=anomaly, prediction=pred, status=status,
        data_error=err, model_error=model_err, threshold_breaches=breaches, active_alerts=active
    )
    sim.last = msg
    return msg

async def broadcast(msg):
    for ws in list(CLIENTS):
        try:
            await ws.send_json(msg)
        except Exception:
            CLIENTS.discard(ws)

async def run():
    c = db.connect()
    try:
        while True:
            await asyncio.sleep(max(0.05, sim.interval / max(0.1, sim.speed)))
            if not sim.running:
                continue
            try:
                msg = process_tick(c)
            except Exception:
                log.exception("Simulation tick failed")
                continue
            await broadcast(msg)
    finally:
        c.close()

