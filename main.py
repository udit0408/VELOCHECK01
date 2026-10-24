"""VELOCHECK FastAPI server: ESP32 ingestion plus dashboard API."""
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DATABASE = Path("/tmp/velocheck.db") if os.getenv("VERCEL") else (ROOT / "velocheck.db")
API_KEY = os.getenv("VELOCHECK_API_KEY", "")

app = FastAPI(title="VELOCHECK API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ESP32 and the PWA can be on different local origins.
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReadingIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    vehicle_type: Literal["bike", "car"] = "bike"
    # Bike: front/rear. Car: front_left/front_right/rear_left/rear_right.
    wheel: str = Field(default="front", min_length=1, max_length=30)
    tyre_distance_mm: float | None = Field(default=None, ge=0)
    tread_depth_mm: float | None = Field(default=None, ge=0)
    temperature_c: float | None = None
    humidity_percent: float | None = Field(default=None, ge=0, le=100)
    pressure_kpa: float | None = Field(default=None, ge=0)


def db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialise_database() -> None:
    with closing(db_connection()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recorded_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                vehicle_type TEXT NOT NULL,
                wheel TEXT NOT NULL,
                tyre_distance_mm REAL,
                tread_depth_mm REAL,
                temperature_c REAL,
                humidity_percent REAL,
                pressure_kpa REAL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_readings_lookup "
            "ON readings(vehicle_type, wheel, id DESC)"
        )
        connection.commit()


@app.on_event("startup")
def startup() -> None:
    initialise_database()


def public_reading(row: sqlite3.Row) -> dict:
    reading = dict(row)
    reading.pop("payload", None)
    pressure_kpa = reading.get("pressure_kpa")
    reading["pressure_psi"] = round(pressure_kpa * 0.145037738, 2) if pressure_kpa is not None else None
    return reading


def _value(row: sqlite3.Row, key: str) -> float | None:
    if key == "pressure_psi":
        return round(row["pressure_kpa"] * 0.145037738, 2) if row["pressure_kpa"] is not None else None
    return row[key]


def _average(rows: list[sqlite3.Row], key: str) -> float | None:
    values = [_value(row, key) for row in rows]
    values = [value for value in values if value is not None]
    return round(sum(values) / len(values), 2) if values else None


@app.get("/api/readings/analytics")
def reading_analytics(
    vehicle_type: Literal["bike", "car"] = "bike",
    wheel: str = "front",
    limit: int = Query(default=20, ge=2, le=100),
) -> dict:
    """Detail data used when a dashboard gauge or health pie is tapped."""
    with closing(db_connection()) as connection:
        rows = connection.execute(
            "SELECT * FROM readings WHERE vehicle_type = ? AND wheel = ? "
            "ORDER BY id DESC LIMIT ?",
            (vehicle_type, wheel, limit),
        ).fetchall()
    rows.reverse()
    if not rows:
        return {"vehicle_type": vehicle_type, "wheel": wheel, "count": 0,
                "previous_record": None, "measuring_time": None,
                "average_last_20": {}, "next_predicted_data": {}}
    fields = ("pressure_psi", "temperature_c", "tread_depth_mm", "humidity_percent")
    averages = {field: _average(rows, field) for field in fields}
    latest = rows[-1]
    previous = public_reading(rows[-2]) if len(rows) > 1 else None
    prediction: dict[str, float | None] = {}
    # A deliberately simple, transparent one-step linear trend forecast.
    for field in fields:
        vals = [_value(row, field) for row in rows]
        vals = [value for value in vals if value is not None]
        if not vals:
            prediction[field] = None
        elif len(vals) == 1:
            prediction[field] = round(vals[-1], 2)
        else:
            prediction[field] = round(vals[-1] + (vals[-1] - vals[0]) / (len(vals) - 1), 2)
    return {
        "vehicle_type": vehicle_type, "wheel": wheel, "count": len(rows),
        "previous_record": previous,
        "measuring_time": latest["recorded_at"],
        "average_last_20": averages,
        "next_predicted_data": prediction,
    }


def require_api_key(authorization: str | None) -> None:
    """Set VELOCHECK_API_KEY in production; leave it unset for local development."""
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/readings", status_code=201)
def create_reading(reading: ReadingIn, authorization: str | None = Header(default=None)) -> dict:
    require_api_key(authorization)
    recorded_at = datetime.now(timezone.utc).isoformat()
    payload = reading.model_dump()
    with closing(db_connection()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO readings (
                recorded_at, device_id, vehicle_type, wheel, tyre_distance_mm,
                tread_depth_mm, temperature_c, humidity_percent, pressure_kpa, payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                recorded_at, reading.device_id, reading.vehicle_type, reading.wheel,
                reading.tyre_distance_mm, reading.tread_depth_mm, reading.temperature_c,
                reading.humidity_percent, reading.pressure_kpa, json.dumps(payload),
            ),
        )
        connection.commit()
        row = connection.execute("SELECT * FROM readings WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return {"accepted": True, "reading": public_reading(row)}


@app.get("/api/readings/latest")
def latest_readings(vehicle_type: Literal["bike", "car"] = "bike") -> dict:
    with closing(db_connection()) as connection:
        rows = connection.execute(
            """
            SELECT r.* FROM readings r
            INNER JOIN (
                SELECT wheel, MAX(id) AS newest_id
                FROM readings WHERE vehicle_type = ? GROUP BY wheel
            ) newest ON newest.newest_id = r.id
            """,
            (vehicle_type,),
        ).fetchall()
    return {"vehicle_type": vehicle_type, "readings": {row["wheel"]: public_reading(row) for row in rows}}


@app.get("/api/readings/history")
def reading_history(
    vehicle_type: Literal["bike", "car"] = "bike",
    wheel: str | None = None,
    limit: int = Query(default=10, ge=1, le=100),
) -> dict:
    query = "SELECT * FROM readings WHERE vehicle_type = ?"
    values: list[object] = [vehicle_type]
    if wheel:
        query += " AND wheel = ?"
        values.append(wheel)
    query += " ORDER BY id DESC LIMIT ?"
    values.append(limit)
    with closing(db_connection()) as connection:
        rows = connection.execute(query, values).fetchall()
    return {"vehicle_type": vehicle_type, "readings": [public_reading(row) for row in reversed(rows)]}


@app.get("/api")
@app.get("/api/")
def api_index() -> dict:
    return {
        "status": "ok",
        "service": "VELOCHECK Telemetry API",
        "endpoints": {
            "health": "/api/health",
            "latest": "/api/readings/latest",
            "history": "/api/readings/history",
            "analytics": "/api/readings/analytics",
            "docs": "/docs",
        },
    }


# Serving the PWA and API from one origin avoids CORS and mobile-app URL issues.
static_dir = (ROOT / "www") if (ROOT / "www").is_dir() else ROOT


@app.get("/")
def serve_root():
    for candidate in [static_dir / "index.html", ROOT / "index.html"]:
        if candidate.is_file():
            return FileResponse(candidate)
    return {"status": "ok", "message": "VELOCHECK API is online"}


@app.get("/{page_name:path}")
def serve_page(page_name: str):
    # Check for direct file or .html extension in static_dir and ROOT
    for base in [static_dir, ROOT]:
        target = (base / page_name).resolve()
        if target.is_file() and str(target).startswith(str(ROOT)):
            return FileResponse(target)
        html_target = (base / f"{page_name}.html").resolve()
        if html_target.is_file() and str(html_target).startswith(str(ROOT)):
            return FileResponse(html_target)
    raise HTTPException(status_code=404, detail="Page not found")


