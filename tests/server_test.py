import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from app.main import app

client = TestClient(app)

clean_payload = {
    "context": {
        "url": "http://localhost:3000/application.html",
        "title": "Job Application",
        "elements": [
            {
                "pgId": "pg-1",
                "tag": "input",
                "type": "email",
                "label": "Email Address",
                "sanitizedText": "[EMAIL]",
                "isVisible": True,
                "piiCategories": ["EMAIL"]
            }
        ]
    },
    "goal": "Submit the application"
}

leaky_payload = {
    "context": {
        "url": "http://localhost:3000/application.html",
        "title": "Job Application",
        "elements": [
            {
                "pgId": "pg-1",
                "tag": "input",
                "type": "email",
                "label": "Email Address",
                "sanitizedText": "test@example.com",  # Leaked email!
                "isVisible": True,
                "piiCategories": []
            }
        ]
    },
    "goal": "Submit the application"
}

leaky_card_payload = {
    "context": {
        "url": "http://localhost:3000/payment",
        "title": "Payment",
        "elements": [
            {
                "pgId": "pg-1",
                "tag": "input",
                "sanitizedText": "4111 1111 1111 1111",  # Unmasked luhn-valid card
                "isVisible": True,
                "piiCategories": []
            }
        ]
    },
    "goal": "Pay"
}

@patch("app.main.get_ollama_action")
def test_plan_returns_valid_action(mock_get_ollama_action):
    # Mocking Ollama returning a ClickAction
    from app.schemas import ClickAction
    mock_get_ollama_action.return_value = ClickAction(action="click", target_id="pg-1", reason="Fill email")
    
    response = client.post("/plan", json=clean_payload)
    assert response.status_code == 200
    assert response.json()["action"] == "click"
    assert response.json()["target_id"] == "pg-1"

def test_server_rejects_raw_email():
    response = client.post("/plan", json=leaky_payload)
    assert response.status_code == 422
    assert "Raw PII detected (EMAIL)" in response.json()["detail"]

def test_server_rejects_raw_card():
    response = client.post("/plan", json=leaky_card_payload)
    assert response.status_code == 422
    assert "Raw PII detected" in response.json()["detail"]
    assert "CREDIT_CARD" in response.json()["detail"]

@patch("app.main.get_ollama_action")
def test_invalid_llm_output_is_handled(mock_get_ollama_action):
    # If the LLM wrapper raises an Exception (like after max retries)
    mock_get_ollama_action.side_effect = Exception("Failed to connect to local LLM")
    
    response = client.post("/plan", json=clean_payload)
    assert response.status_code == 500
    assert "Failed to connect" in response.json()["detail"]

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200

def test_validator_enforces_origin_allowlist():
    response = client.post("/execute/validate", json={"action": "navigate", "url": "http://localhost:3000/success", "reason": "Test"})
    assert response.status_code == 200

    response = client.post("/execute/validate", json={"action": "navigate", "url": "https://evil.com/steal", "reason": "Evil"})
    assert response.status_code == 403

    # Schema validation inherently blocks execute_script or shell
    response = client.post("/execute/validate", json={"action": "execute_script", "code": "alert(1)", "reason": "XSS"})
    assert response.status_code == 422  # Pydantic validation error