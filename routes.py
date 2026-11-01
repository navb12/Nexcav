import csv, datetime as dt, io, pandas as pd
from typing import Optional
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
def _q(sql, p=()):
    c = db.connect()
    try: return [dict(r) for r in c.execute(sql, p).fetchall()]
    finally: c.close()
def _exec(sql, p=()):
    c = db.connect()
    try: cur = c.execute(sql, p); c.commit(); return cur.rowcount
    finally: c.close()
def _event(kind, detail=""):
    c = db.connect()
    try: db.log_event(c, now(), sim.pump_id, kind, detail)
    finally: c.close()

def status_dict():
    b = registry.get()
    active = _q("SELECT COUNT(*) n FROM alerts WHERE pump=? AND status!='resolved'", (sim.pump_id,))[0]["n"]
    return dict(running=sim.running, scenario=sim.scenario, speed=sim.speed, interval=sim.interval, tick=sim.tick, sim_clock_s=sim.sim_t,
                scenario_severity=round(sim.sev, 3), custom=sim.custom, pump=dict(id=sim.pump_id, name=sim.pump_name), active_alerts=active,
                model=dict(loaded=b is not None, version=b and b["version"], error=registry._state.get("error")), latest=sim.last, simulated=True)

@router.get("/api/health")
def health():
    try: _q("SELECT 1"); dbok = True
    except Exception: dbok = False
    return dict(ok=dbok, model_loaded=registry.get() is not None, db=dbok, simulated=True)
@router.get("/api/status")
def status(): return status_dict()

def _ctl(kind, running):
    sim.running = running; _event(kind); return status_dict()
@router.post("/api/sim/start")
def start(): return _ctl("sim_start", True)
@router.post("/api/sim/pause")
def pause(): return _ctl("sim_pause", False)
@router.post("/api/sim/resume")
def resume(): return _ctl("sim_resume", True)
@router.post("/api/sim/reset")
def reset():
    sim.running = False; sim.reset_state(); engine.reset(); _event("sim_reset"); return status_dict()
@router.post("/api/sim/scenario/{name}")
def scenario(name: str):
    if name not in SCENARIOS: raise HTTPException(400, f"scenario must be one of {SCENARIOS}")
    prev = sim.scenario; sim.scenario = name; _event("scenario_change", f"{prev} -> {name}"); return status_dict()
@router.post("/api/sim/config")
def sim_config(c: SimConfig):
    s = config.get(); s["simulation"].update(speed=c.speed, interval_s=c.interval); config.update(Settings.model_validate(s)); return status_dict()
@router.post("/api/sim/custom")
def custom(c: Reading):
    sim.custom = c.model_dump(); prev = sim.scenario; sim.scenario = "custom"
    if prev != "custom": _event("scenario_change", f"{prev} -> custom")
    return status_dict()
@router.post("/api/sim/inject-anomaly")
def inject(a: AnomalyReq): sim.pending_anomaly = a.kind; return dict(queued=a.kind)

@router.post("/api/predict")
def predict_ep(r: Reading):
    try: p = score(r.model_dump(), config.get()["risk"])
    except ModelUnavailable as e: raise HTTPException(503, f"Model unavailable: {e}")
    return dict(input_valid=True, timestamp=now(), **p)

def _iso(v, name, end=False):
    if not v: return None
    try: dt.datetime.fromisoformat(v)
    except ValueError: raise HTTPException(422, f"{name} must be ISO 8601")
    return v + "T23:59:59.999" if end and len(v) == 10 else v
def _where(start, end, scenario=None, min_risk=None, col="ts"):
    w, p = [], []
    s, e = _iso(start, "start"), _iso(end, "end", True)
    if s: w.append(f"{col}>=?"); p.append(s)
    if e: w.append(f"{col}<=?"); p.append(e)
    if scenario: w.append("scenario=?"); p.append(scenario)
    if min_risk is not None: w.append("risk_level>=?"); p.append(min_risk)
    return (" WHERE " + " AND ".join(w) if w else ""), p

@router.get("/api/live/recent")
def live_recent(n: int = 120): return list(reversed(_q("SELECT * FROM readings ORDER BY id DESC LIMIT ?", (min(max(n, 1), 2000),))))
@router.get("/api/history")
def history(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None, min_risk_level: Optional[int] = None, limit: int = 1000):
    w, p = _where(start, end, scenario, min_risk_level)
    return list(reversed(_q(f"SELECT * FROM readings{w} ORDER BY id DESC LIMIT ?", (*p, min(max(limit, 1), 20000)))))
@router.get("/api/history/summary")
def summary(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None):
    w, p = _where(start, end, scenario); aw, ap = _where(start, end, col="ts")
    c = db.connect()
    try: df = pd.read_sql_query(f"SELECT * FROM readings{w}", c, params=p); na = c.execute(f"SELECT COUNT(*) FROM alerts{aw}", ap).fetchone()[0]
    finally: c.close()
    if df.empty: return dict(count=0, alerts=na)
    st = {k: dict(mean=float(df[k].mean()), min=float(df[k].min()), max=float(df[k].max()), std=float(df[k].std() or 0)) for k in RAW if df[k].notna().any()}
    sc = df.model_score.dropna()
    return dict(count=int(len(df)), first_ts=df.ts.iloc[0], last_ts=df.ts.iloc[-1], sensors=st, status_counts=df.status.value_counts().to_dict(),
                model_score=dict(mean=float(sc.mean()), max=float(sc.max())) if len(sc) else None, alerts=na, data_errors=int((df.status == "Sensor/Data Error").sum()))
@router.get("/api/history/export")
def export(start: Optional[str] = None, end: Optional[str] = None, scenario: Optional[str] = None, min_risk_level: Optional[int] = None):
    w, p = _where(start, end, scenario, min_risk_level); c = db.connect(); buf = io.StringIO()
    try:
        cur = c.execute(f"SELECT * FROM readings{w} ORDER BY id", p); wr = csv.writer(buf); wr.writerow([d[0] for d in cur.description]); wr.writerows(cur.fetchall())
    finally: c.close()
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=pumpguard_history.csv"})
@router.get("/api/events")
def events(start: Optional[str] = None, end: Optional[str] = None, limit: int = 500):
    w, p = _where(start, end); return list(reversed(_q(f"SELECT * FROM events{w} ORDER BY id DESC LIMIT ?", (*p, min(limit, 5000)))))

@router.get("/api/alerts")
def alerts(status: Optional[str] = None, category: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, limit: int = 200):
    w, p = _where(start, end)
    for col, v in (("status", status), ("category", category)):
        if v: w += (" AND " if w else " WHERE ") + f"{col}=?"; p.append(v)
    return _q(f"SELECT * FROM alerts{w} ORDER BY id DESC LIMIT ?", (*p, min(limit, 2000)))
def _alert_update(aid, new, col):
    if not _q("SELECT 1 FROM alerts WHERE id=?", (aid,)): raise HTTPException(404, "Alert not found")
    _exec(f"UPDATE alerts SET status=?, {col}=? WHERE id=? AND status!='resolved'", (new, now(), aid)); return _q("SELECT * FROM alerts WHERE id=?", (aid,))[0]
@router.post("/api/alerts/{aid}/ack")
def ack(aid: int): return _alert_update(aid, "acknowledged", "ack_ts")
@router.post("/api/alerts/{aid}/resolve")
def resolve(aid: int): return _alert_update(aid, "resolved", "resolved_ts")

@router.get("/api/settings")
def get_settings(): return config.get()
@router.put("/api/settings")
def put_settings(s: Settings): return config.update(s)
@router.post("/api/demo/reset-data")
def reset_data(confirm: bool = False):
    if not confirm: raise HTTPException(400, "confirm=true required")
    c = db.connect()
    try:
        for t in ("readings", "alerts", "events"): c.execute(f"DELETE FROM {t}")
        c.commit()
    finally: c.close()
    engine.reset(); return dict(ok=True)

@router.websocket("/ws/live")
async def ws(w: WebSocket):
    await w.accept(); CLIENTS.add(w)
    try:
        await w.send_json(dict(type="snapshot", **status_dict()))
        while True:
            if await w.receive_text() == "ping": await w.send_json(dict(type="pong"))
    except WebSocketDisconnect: pass
    finally: CLIENTS.discard(w)
