from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv
import json
import logging
from typing import List

from .schemas import UIContext, PlanRequest, ActionType
from .privacy import validate_payload_is_clean
from .agent import get_ollama_action
from .database import get_db, AuditLog, Metric

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import os

app = FastAPI(title="PrivacyGuard Server")

# Allow extension to talk to us
ALLOWED_ORIGINS = [orig for orig in os.getenv("ALLOWED_ORIGINS", "").split(",") if orig]
if not ALLOWED_ORIGINS:
    # Default restrict in dev
    ALLOWED_ORIGINS = ["chrome-extension://*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PAYLOAD_SCHEMA_VERSION = "1.0.0"

def _log_audit(db: Session, event_type: str, details: dict):
    log = AuditLog(event_type=event_type, details=json.dumps(details))
    db.add(log)
    db.commit()

@app.get("/version")
def get_version():
    return {"version": PAYLOAD_SCHEMA_VERSION}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/analyze")
def analyze_context(context: UIContext, db: Session = Depends(get_db)):
    leaks = validate_payload_is_clean(context.model_dump())
    if leaks:
        _log_audit(db, "PII_LEAK_PREVENTED", {"categories": leaks, "endpoint": "/analyze"})
        raise HTTPException(status_code=422, detail=f"Payload rejected: Raw PII detected ({', '.join(leaks)})")
    
    _log_audit(db, "CONTEXT_ANALYZED", {"elements_count": len(context.elements)})
    return {"status": "clean", "elements": len(context.elements)}

@app.post("/plan", response_model=ActionType)
async def plan_action(request: PlanRequest, db: Session = Depends(get_db)):
    leaks = validate_payload_is_clean(request.model_dump())
    if leaks:
        _log_audit(db, "PII_LEAK_PREVENTED", {"categories": leaks, "endpoint": "/plan"})
        db.add(Metric(latency_ms=0, success=0, pii_blocked_count=len(leaks)))
        db.commit()
        raise HTTPException(status_code=422, detail=f"Payload rejected: Raw PII detected ({', '.join(leaks)})")
    
    import time
    start = time.time()
    try:
        action = await get_ollama_action(request.context, request.goal)
        latency = (time.time() - start) * 1000
        
        _log_audit(db, "ACTION_PLANNED", {"action": action.action})
        db.add(Metric(latency_ms=latency, success=1, pii_blocked_count=0))
        db.commit()
        
        return action
    except Exception as e:
        latency = (time.time() - start) * 1000
        db.add(Metric(latency_ms=latency, success=0, pii_blocked_count=0))
        db.commit()
        logger.error(f"Planning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/execute/validate")
def validate_action(action: ActionType, db: Session = Depends(get_db)):
    # Restrict navigation to an origin allowlist
    if action.action == "navigate":
        allowed_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
        if action.url:
            from urllib.parse import urlparse
            parsed = urlparse(action.url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            if origin not in allowed_origins:
                raise HTTPException(status_code=403, detail="Navigation to unapproved origin blocked.")
    
    # Schema validation (Pydantic) inherently prevents execute_script, shell, eval, etc.
    # since they are not valid ActionType variants.
    
    _log_audit(db, "ACTION_VALIDATED", {"action": action.action})
    return {"status": "approved"}

@app.get("/metrics")
def get_metrics(db: Session = Depends(get_db)):
    metrics = db.query(Metric).all()
    # Summarize
    total = len(metrics)
    successes = sum(m.success for m in metrics) if total > 0 else 0
    avg_latency = (sum(m.latency_ms for m in metrics) / total) if total > 0 else 0
    pii_blocked = sum(m.pii_blocked_count for m in metrics) if total > 0 else 0
    
    import psutil
    cpu_percent = psutil.cpu_percent(interval=0.1)
    server_proc = psutil.Process(os.getpid())
    server_ram_mb = server_proc.memory_info().rss / (1024 * 1024)

    ollama_rss = 0
    for p in psutil.process_iter(['name', 'memory_info']):
        try:
            p_name = p.info.get('name') or ''
            if 'ollama' in p_name.lower():
                mem = p.info.get('memory_info')
                if mem:
                    ollama_rss += mem.rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    model_in_memory_mb = None
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:11434/api/ps", headers={"User-Agent": "PrivacyGuard"})
        with urllib.request.urlopen(req, timeout=0.5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode())
                models = data.get("models", [])
                if models:
                    model_size_bytes = sum(m.get("size", 0) for m in models)
                    model_in_memory_mb = round((ollama_rss + model_size_bytes) / (1024 * 1024), 2)
    except Exception:
        pass

    return {
        "total_requests": total,
        "success_rate": successes / total if total > 0 else 0,
        "avg_latency_ms": avg_latency,
        "total_pii_blocked": pii_blocked,
        "server_cpu_percent": cpu_percent,
        "server_ram_mb": round(server_ram_mb, 2),
        "ollama_ram_mb": model_in_memory_mb,
        "model_in_memory_mb": model_in_memory_mb
    }

@app.get("/privacy-log")
def get_privacy_log(db: Session = Depends(get_db), limit: int = 50):
    logs = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit).all()
    return logs
