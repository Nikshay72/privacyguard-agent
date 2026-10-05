import os
import sys
import time
import httpx
import json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "server")))

from app.schemas import ActionType
from app.prompts import SYSTEM_PROMPT, build_prompt
from pydantic import TypeAdapter, ValidationError

action_adapter = TypeAdapter(ActionType)

TEST_CONTEXT = {
    "url": "http://localhost:3000/application.html",
    "title": "Application",
    "elements": [
        {"pgId": "pg-1", "tag": "input", "type": "text", "sanitizedText": "[PERSON]", "isVisible": True, "piiDetected": []},
        {"pgId": "pg-2", "tag": "button", "sanitizedText": "Submit Application", "isVisible": True, "piiDetected": []}
    ]
}

def evaluate_ollama(model="qwen2.5:3b-instruct", host="http://127.0.0.1:11434"):
    print(f"Evaluating {model} on {host}...")
    successes = 0
    total_time = 0.0
    runs = 20

    user_prompt = build_prompt(TEST_CONTEXT, goal="Click the submit button to finish.")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ],
        "format": "json",
        "stream": False,
        "keep_alive": "10m",
        "options": {
            "temperature": 0.0,
            "num_predict": 120,
            "num_ctx": 2048
        }
    }

    latencies = []
    try:
        with httpx.Client(timeout=90.0) as client:
            for i in range(runs):
                start = time.time()
                try:
                    response = client.post(f"{host}/api/chat", json=payload)
                    response.raise_for_status()
                    
                    data = response.json()
                    content = data["message"]["content"]
                    
                    try:
                        parsed = json.loads(content)
                        # Ensure we can parse it as our Action schema
                        action_adapter.validate_python(parsed)
                        successes += 1
                    except (json.JSONDecodeError, ValidationError) as ve:
                        print(f"Run {i+1} failed schema validation: {ve}")
                        
                except httpx.RequestError as e:
                    print(f"Connection error on run {i+1}: {e}")
                    # Stop early if connection totally fails
                    if i == 0:
                        print("Failed to connect to Ollama. Aborting evaluation.")
                        break
                        
                latency = time.time() - start
                latencies.append(latency)
                total_time += latency
                print(f"Run {i+1}: {latency:.3f}s")
    except Exception as e:
        print(f"Fatal error: {e}")

    if successes > 0 or runs == 0:
        avg_latency = total_time / len(latencies) if latencies else 0
        sorted_latencies = sorted(latencies)
        median_lat = sorted_latencies[len(sorted_latencies) // 2] if sorted_latencies else 0
        p95_lat = sorted_latencies[int(len(sorted_latencies) * 0.95)] if sorted_latencies else 0
        print("\n--- RESULTS ---")
        print(f"Model: {model}")
        print(f"Valid JSON Schema Rate: {successes}/{runs} ({(successes/runs)*100:.1f}%)")
        print(f"Average Latency: {avg_latency:.3f}s")
        print(f"Median Latency: {median_lat:.3f}s")
        print(f"P95 Latency: {p95_lat:.3f}s")
    else:
        print("\n--- RESULTS ---")
        print("0 successes. Ollama is likely not running.")

if __name__ == "__main__":
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
    evaluate_ollama(model)
