import os
from fastapi.testclient import TestClient

os.environ["ALLOWED_ORIGINS"] = "chrome-extension://abcdefghijklmnop"

from app.main import app

client = TestClient(app)

def test_cors_rejects_evil_origin():
    # Pre-flight request
    headers = {
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
    }
    response = client.options("/plan", headers=headers)
    
    # Fastapi CORSMiddleware returns 400 for disallowed origins in strict mode, 
    # but with chrome-extension://* it might be tricky. Let's see what happens.
    # Actually, Starlette CORS will just not include Access-Control-Allow-Origin if origin is not allowed
    # (or returns 400 Bad Request if it's a preflight and origin is not allowed).
    assert "access-control-allow-origin" not in response.headers

def test_cors_allows_chrome_extension():
    headers = {
        "Origin": "chrome-extension://abcdefghijklmnop",
        "Access-Control-Request-Method": "POST",
    }
    response = client.options("/plan", headers=headers)
    assert response.headers.get("access-control-allow-origin") == "chrome-extension://abcdefghijklmnop"
