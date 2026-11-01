import csv
import datetime as dt
import io
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from app.database import db
from app.ml import registry
from app.schemas.models import Reading, SimConfig, AnomalyReq, Settings
from app.services import config
from app.services.alerts import engine
from app.services.runner import CLIENTS, now
from app.services.scoring import score, ModelUnavailable
from app.simulation.engine import sim, SCENARIOS, RAW

router = APIRouter()

def _q(sql: str, p: tuple = ()) -> List[Dict[str, Any]]:
    c = db.connect()
    try:
        return [dict(r) for r in c.execute(sql, p).fetchall()]
    finally:
        c.close()

def _exec(sql: str, p: tuple = ()) -> int:
    c = db.connect()
    try:
        cur = c.execute(sql, p)
        c.commit()
        return cur.rowcount
    finally:
        c.close()

def _event(kind: str, detail: str = ""):
    c = db.connect()
    try:
        db.log_event(c, now(), sim.pump_id, kind, detail)
        c.commit()
    finally:
        c.close()

def status_dict():
    b = registry.get()
    rows = _q("SELECT COUNT(*) as n FROM alerts WHERE pump=? AND status!='resolved'", (sim.pump_id,))
    active = rows[0]["n"] if rows else 0
    return dict(
        running=sim.running,
        scenario=sim.scenario,
        speed=sim.speed,
        interval=sim.interval,
        tick=sim.tick,
        sim_clock_s=round(sim.sim_t, 2),
        scenario_severity=round(sim.sev, 3),
        custom=sim.custom,
        pump=dict(id=sim.pump_id, name=sim.pump_name),
        active_alerts=active,
        model=dict(
            loaded=b is not None,
            version=b and b.get("version"),
            error=registry._state.get("error")
        ),
        latest=sim.last,
        simulated=True
    )

@router.get("/api/health")
def health():
    try:
        _q("SELECT 1")
        dbok = True
    except Exception:
        dbok = False
    return dict(ok=dbok, model_loaded=registry.get() is not None, db=dbok, simulated=True)

@router.get("/api/status")
def status():
    return status_dict()

def _ctl(kind: str, running: bool):
    sim.running = running
    _event(kind)
    return status_dict()

@router.post("/api/sim/start")
def start():
    return _ctl("sim_start", True)

@router.post("/api/sim/pause")
def pause():
    return _ctl("sim_pause", False)

@router.post("/api/sim/resume")
def resume():
    return _ctl("sim_resume", True)

@router.post("/api/sim/reset")
def reset():
    sim.running = False
    sim.reset_state()
    engine.reset()
    _event("sim_reset")
    return status_dict()

@router.post("/api/sim/scenario/{name}")
def scenario(name: str):
    if name not in SCENARIOS:
        raise HTTPException(400, f"scenario must be one of {SCENARIOS}")
    prev = sim.scenario
    sim.scenario = name
    _event("scenario_change", f"{prev} -> {name}")
    return status_dict()

@router.post("/api/sim/config")
def sim_config(c: SimConfig):
    s = config.get()
    s["simulation"].update(speed=c.speed, interval_s=c.interval)
    config.update(Settings.model_validate(s))
    sim.apply_settings(s)
    return status_dict()

@router.post("/api/sim/custom")
def custom(c: Reading):
    sim.custom = c.model_dump()
    prev = sim.scenario
    sim.scenario = "custom"
    if prev != "custom":
        _event("scenario_change", f"{prev} -> custom")
    return status_dict()

@router.post("/api/sim/inject-anomaly")
def inject(a: AnomalyReq):
    sim.pending_anomaly = a.kind
    return dict(queued=a.kind)

@router.post("/api/predict")
def predict_ep(r: Reading):
    try:
        p = score(r.model_dump(), config.get().get("risk", {}))
    except ModelUnavailable as e:
        raise HTTPException(503, f"Model unavailable: {e}")
    except ValueError as e:
        raise HTTPException(422, f"Validation error: {e}")
    return dict(input_valid=True, timestamp=now(), **p)

def _iso(v: Optional[str], name: str, end: bool = False):
    if not v:
        return None
    try:
        dt.datetime.fromisoformat(v)
    except ValueError:
        raise HTTPException(422, f"{name} must be ISO 8601")
    return v + "T23:59:59.999" if end and len(v) == 10 else v

def _where(start: Optional[str], end: Optional[str], scenario: Optional[str] = None, min_risk: Optional[int] = None, col: str = "ts"):
    w, p = [], []
    s, e = _iso(start, "start"), _iso(end, "end", True)
    if s:
        w.append(f"{col}>=?")
        p.append(s)
    if e:
        w.append(f"{col}<=?")
        p.append(e)
    if scenario:
        w.append("scenario=?")
        p.append(scenario)
    if min_risk is not None:
        w.append("risk_level>=?")
        p.append(min_risk)
    return (" WHERE " + " AND ".join(w) if w else ""), p

@router.get("/api/live/recent")
def live_recent(n: int = 120):
    return list(reversed(_q("SELECT * FROM readings ORDER BY id DESC LIMIT ?", (min(max(n, 1), 2000),))))

@router.get("/api/history")
def history(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None, min_risk_level: Optional[int] = None, limit: int = 1000):
    w, p = _where(start, end, scenario, min_risk_level)
    return list(reversed(_q(f"SELECT * FROM readings{w} ORDER BY id DESC LIMIT ?", (*p, min(max(limit, 1), 20000)))))

@router.get("/api/history/summary")
def summary(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None):
    w, p = _where(start, end, scenario)
    aw, ap = _where(start, end, col="ts")
    readings = _q(f"SELECT * FROM readings{w}", tuple(p))
    na_rows = _q(f"SELECT COUNT(*) as cnt FROM alerts{aw}", tuple(ap))
    na = na_rows[0]["cnt"] if na_rows else 0
    
    if not readings:
        return dict(count=0, alerts=na)
        
    sensors = {}
    for k in RAW:
        vals = [r[k] for r in readings if r[k] is not None]
        if vals:
            mean = sum(vals) / len(vals)
            variance = sum((x - mean) ** 2 for x in vals) / len(vals)
            sensors[k] = dict(
                mean=round(mean, 2),
                min=round(min(vals), 2),
                max=round(max(vals), 2),
                std=round(variance ** 0.5, 2)
            )
            
    scores = [r["model_score"] for r in readings if r.get("model_score") is not None]
    status_counts = {}
    for r in readings:
        st = r.get("status", "Unknown")
        status_counts[st] = status_counts.get(st, 0) + 1
        
    data_errors = sum(1 for r in readings if r.get("status") == "Sensor/Data Error")
    
    return dict(
        count=len(readings),
        first_ts=readings[0]["ts"],
        last_ts=readings[-1]["ts"],
        sensors=sensors,
        status_counts=status_counts,
        model_score=dict(mean=round(sum(scores)/len(scores), 3), max=round(max(scores), 3)) if scores else None,
        alerts=na,
        data_errors=data_errors
    )

@router.get("/api/history/export")
def export(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None, min_risk_level: Optional[int] = None):
    w, p = _where(start, end, scenario, min_risk_level)
    c = db.connect()
    buf = io.StringIO()
    try:
        cur = c.execute(f"SELECT * FROM readings{w} ORDER BY id", p)
        wr = csv.writer(buf)
        wr.writerow([d[0] for d in cur.description])
        wr.writerows(cur.fetchall())
    finally:
        c.close()
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pumpguard_history.csv"}
    )

@router.get("/api/events")
def events(start: Optional[str] = None, end: Optional[str] = None, limit: int = 500):
    w, p = _where(start, end)
    return list(reversed(_q(f"SELECT * FROM events{w} ORDER BY id DESC LIMIT ?", (*p, min(limit, 5000)))))

@router.get("/api/alerts")
def alerts(status: Optional[str] = None, category: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, limit: int = 200):
    w, p = _where(start, end)
    for col, v in (("status", status), ("category", category)):
        if v:
            w += (" AND " if w else " WHERE ") + f"{col}=?"
            p.append(v)
    return _q(f"SELECT * FROM alerts{w} ORDER BY id DESC LIMIT ?", (*p, min(limit, 2000)))

def _alert_update(aid: int, new_status: str, col: str):
    if not _q("SELECT 1 FROM alerts WHERE id=?", (aid,)):
        raise HTTPException(404, "Alert not found")
    _exec(f"UPDATE alerts SET status=?, {col}=? WHERE id=? AND status!='resolved'", (new_status, now(), aid))
    return _q("SELECT * FROM alerts WHERE id=?", (aid,))[0]

@router.post("/api/alerts/{aid}/ack")
def ack(aid: int):
    return _alert_update(aid, "acknowledged", "ack_ts")

@router.post("/api/alerts/{aid}/resolve")
def resolve(aid: int):
    return _alert_update(aid, "resolved", "resolved_ts")

@router.get("/api/settings")
def get_settings():
    return config.get()

@router.put("/api/settings")
def put_settings(s: Settings):
    updated = config.update(s)
    sim.apply_settings(updated)
    return updated

@router.post("/api/demo/reset-data")
def reset_data(confirm: bool = False):
    if not confirm:
        raise HTTPException(400, "confirm=true required")
    c = db.connect()
    try:
        for t in ("readings", "alerts", "events"):
            c.execute(f"DELETE FROM {t}")
        c.commit()
    finally:
        c.close()
    engine.reset()
    return dict(ok=True)

@router.websocket("/ws/live")
async def ws(w: WebSocket):
    await w.accept()
    CLIENTS.add(w)
    try:
        await w.send_json(dict(type="snapshot", **status_dict()))
        while True:
            text = await w.receive_text()
            if text == "ping":
                await w.send_json(dict(type="pong"))
    except WebSocketDisconnect:
        pass
    finally:
        CLIENTS.discard(w)

