import os
import httpx
import json
from .schemas import UIContext, ActionType
from .prompts import SYSTEM_PROMPT, build_prompt
from pydantic import ValidationError, TypeAdapter
import logging

logger = logging.getLogger(__name__)

action_adapter = TypeAdapter(ActionType)

async def get_ollama_action(context: UIContext, goal: str) -> ActionType:
    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
    
    user_prompt = build_prompt(context, goal)
    
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

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(f"{host}/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["message"]["content"]
            
            try:
                parsed = json.loads(content)
                return action_adapter.validate_python(parsed)
            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning(f"Validation failed on first attempt: {e}. Retrying with repair prompt.")
                repair_prompt = f"Your previous output was invalid JSON or did not match the schema. Error: {str(e)}. Please try again and output ONLY valid JSON matching the exact action schema."
                payload["messages"].append({"role": "assistant", "content": content})
                payload["messages"].append({"role": "user", "content": repair_prompt})
                
                response = await client.post(f"{host}/api/chat", json=payload)
                response.raise_for_status()
                data = response.json()
                content = data["message"]["content"]
                
                parsed = json.loads(content)
                return action_adapter.validate_python(parsed)
                
        except httpx.RequestError as e:
            logger.error(f"Error communicating with Ollama: {e}")
            raise Exception("Failed to connect to local LLM. Is Ollama running?")
