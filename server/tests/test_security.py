from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_server_rejects_injected_pii_anywhere():
    # Valid payload
    payload = {
        "context": {
            "url": "http://localhost:3000",
            "title": "Checkout",
            "elements": [
                {
                    "pgId": "pg-abcde-1",
                    "tag": "input",
                    "type": "text",
                    "sanitizedText": "[CREDIT_CARD_FILLED]",
                    "isVisible": True,
                    "piiCategories": ["CREDIT_CARD"]
                }
            ]
        },
        "goal": "Submit payment"
    }
    
    # Clean payload should pass /plan validation (returns 500 if Ollama is not mocked, but NOT 422)
    response = client.post("/plan", json=payload)
    print(response.json())
    assert response.status_code != 422
    
    # Inject PII in an allowed field
    payload["context"]["elements"][0]["sanitizedText"] = "My email is test@example.com"
    response = client.post("/plan", json=payload)
    assert response.status_code == 422
    
    # Inject PII in an unexpected field
    payload["context"]["elements"][0]["sanitizedText"] = "[FILLED]"
    payload["context"]["elements"][0]["label"] = "Contact me at alice@hackers.com"
    response = client.post("/plan", json=payload)
    assert response.status_code == 422

def test_server_rejects_extra_fields():
    payload = {
        "context": {
            "url": "http://localhost:3000",
            "title": "Checkout",
            "elements": [
                {
                    "pgId": "pg-abcde-1",
                    "tag": "input",
                    "sanitizedText": "[FILLED]",
                    "isVisible": True,
                    "extra_field": "hacked"
                }
            ]
        },
        "goal": "Submit"
    }
    response = client.post("/plan", json=payload)
    assert response.status_code == 422

def test_server_password_like_scope():
    # 1. name="billingAddress1" and "address_line2" should be accepted (no PASSWORD_LIKE trigger on name)
    payload = {
        "context": {
            "url": "http://localhost:3000",
            "title": "Checkout",
            "elements": [
                {
                    "pgId": "pg-abcde-1",
                    "tag": "input",
                    "name": "billingAddress1",
                    "sanitizedText": "[FILLED]",
                    "isVisible": True
                },
                {
                    "pgId": "pg-abcde-2",
                    "tag": "input",
                    "name": "address_line2",
                    "sanitizedText": "[FILLED]",
                    "isVisible": True
                }
            ]
        },
        "goal": "Submit"
    }
    response = client.post("/plan", json=payload)
    assert response.status_code != 422

    # 2. Raw "mySecret123" in sanitizedText is rejected
    payload["context"]["elements"][0]["sanitizedText"] = "mySecret123"
    response = client.post("/plan", json=payload)
    assert response.status_code == 422

def test_contract_payload():
    import json
    import os
    from app.schemas import PlanRequest
    import pytest
    from pydantic import ValidationError

    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "contract_payload.json")
    with open(fixture_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    
    # 1. Real wire payload validates against PlanRequest schema
    validated = PlanRequest.model_validate(payload)
    assert validated.context.url.startswith("http")
    assert len(validated.context.elements) > 0

    # 2. Server accepts valid contract payload (not 422)
    response = client.post("/plan", json=payload)
    assert response.status_code != 422

    # 3. Adding an unexpected field on context or element fails with ValidationError due to extra="forbid"
    bad_payload = json.loads(json.dumps(payload))
    bad_payload["context"]["elements"][0]["unexpected_new_field"] = "bad"
    with pytest.raises(ValidationError):
        PlanRequest.model_validate(bad_payload)

    response = client.post("/plan", json=bad_payload)
    assert response.status_code == 422

def test_version_endpoint():
    from app.main import PAYLOAD_SCHEMA_VERSION
    response = client.get("/version")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == PAYLOAD_SCHEMA_VERSION == "1.0.0"

def test_captured_payment_goal_payload():
    import json
    import os
    from app.schemas import PlanRequest

    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "captured_payment_goal_payload.json")
    if os.path.exists(fixture_path):
        with open(fixture_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        
        # Must validate against Pydantic schema without extra forbidden fields
        PlanRequest.model_validate(payload)
        
        # TestClient post to /plan must not be 422
        response = client.post("/plan", json=payload)
        assert response.status_code != 422
