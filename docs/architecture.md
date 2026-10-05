# Architecture & Model Selection

## Overall Architecture
PrivacyGuard is a local-first privacy firewall for AI browser agents. The architecture is split into three main layers:

1. **Perception Layer (Extension)**: 
   - **DOM Scanner**: Extracts actionable nodes, assigns stable `pg-id`s, and locates coordinates.
   - **Local Vision**: Runs ONNX Runtime Web in an offscreen document to detect faces, sensitive text in images/canvas, and fallback contextual clues.
   - **Sanitizer**: Redacts text using Regex + Heuristics and masks the captured screenshot via HTML Canvas.

2. **Reasoning Layer (Local Server & LLM)**: 
   - **FastAPI Server**: Re-verifies payloads for leaked PII.
   - **Ollama LLM**: Receives *only* sanitized context, plans the next step, and outputs a strict JSON action.

3. **Execution Layer (Extension)**:
   - Validates the action against allowed schemas and targets.
   - Prompts the user if the action is irreversible (e.g., clicking "Pay").
   - Dispatches the DOM event.

## Model Selection (Vision)

The goal was to select pretrained, small, and fast models suitable for CPU/WebGPU execution inside a browser extension, with no external CDN calls.

### Face Detection Candidates
| Model | Size | License | Load Time (est) | Inference (CPU/WASM) | Decision |
|---|---|---|---|---|---|
| **BlazeFace** | ~200 KB | Apache 2.0 | < 100ms | ~5-10ms | **Selected**. Extremely lightweight, fast enough for real-time, permissive license. |
| **UltraFace (RFB-320)** | ~1.1 MB | MIT | ~200ms | ~15-20ms | Good fallback, but slightly larger than BlazeFace. |
| **YOLOv8n-face** | ~6.0 MB | AGPL | ~500ms | ~50-80ms | Too large for a lightweight extension, restrictive open-source license. |

### Text Region Detection Candidates (Images/Canvas)
| Model | Size | License | Load Time (est) | Inference (CPU/WASM) | Decision |
|---|---|---|---|---|---|
| **DBNet (MobileNetV3)** | ~5-10 MB | Apache 2.0 | ~400ms | ~40-60ms | **Selected**. Balances accuracy with size. Fast enough for page-load perception. |
| **EAST (ResNet)** | ~90 MB | MIT | ~2000ms | ~150ms | Too large. Will bloat extension size and cause memory issues on low-end devices. |
| **CRAFT** | ~80 MB | MIT | ~2000ms | ~200ms | Too large. |

## Fallback Chain
Since we cannot guarantee WebGPU support or even WASM performance on all client devices, the Vision layer implements a strict fallback chain:
1. **WebGPU**: Hardware acceleration (if available via Chrome flags / modern hardware).
2. **WASM (SIMD/Threaded)**: Multi-threaded CPU execution.
3. **DOM-only**: If ONNX Runtime fails to initialize or the model file is missing/corrupted, the system gracefully degrades to DOM-only perception. It will *never* crash the agent loop.
