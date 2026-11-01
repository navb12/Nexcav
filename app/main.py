import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import db
from app.services import config
from app.services.runner import run
from app.simulation.engine import sim
from app.ml import registry
from app.api.routes import router as core_router
from app.ml_api import router as ml_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables
    db.init_db()
    # Load configuration
    cfg = config.get()
    sim.apply_settings(cfg)
    # Attempt to load ML model
    registry.load_active()
    # Start the simulation loop task in background
    sim_task = asyncio.create_task(run())
    try:
        yield
    finally:
        sim_task.cancel()
        try:
            await sim_task
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title="PumpGuard AI - Cavitation Diagnostics & Real-time Telemetry API",
    description="Backend API and live simulation for centrifugal pump cavitation detection and predictive maintenance.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for local Vite development frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(core_router)
app.include_router(ml_router)

# Mount frontend static files if built
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

