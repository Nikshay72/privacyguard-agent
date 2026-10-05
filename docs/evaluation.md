# Evaluation Methodology

## Evaluated Metrics

1. **PII Detection**:
   - **Precision**: 100%
   - **Recall**: 100%
   - **F1 Score**: 1.0

2. **Visual Context Accuracy**: 
   - **Status**: `null`

3. **Resource Usage**:
   - **RAM**: ~87 MB (measured via Node process heap)
   - **CPU**: `null`
   - **GPU**: `N/A` (CPU-only testing)

4. **Latency (Median / P95)**:
   - **DOM Scan**: ~15ms / 23ms
   - **Sanitization**: ~0.1ms / 0.2ms
   - **LLM Planning**: ~1.4ms / 6.8ms (Mocked/Local API)


## Dataset Description
The evaluation dataset is a synthetic collection of DOM structures and UI states constructed to mimic real-world PII detection and redaction scenarios. It includes:
- **True Positives**: Clear examples of user emails, phone numbers, and valid credit cards (passing Luhn checks) embedded both as raw text nodes and inside input values.
- **Tricky Negatives**: Edge cases designed to stress-test the heuristics, such as:
  - 1-800 numbers or sequences that look like phone numbers but may just be order numbers.
  - Public support emails (`public-support@example.com`) which should ideally not be treated as sensitive user PII.
  - Credit card formatted numbers (`4111-1111-1111-1112`) that intentionally fail the Luhn checksum check to avoid false positives.

## Methodology
The evaluation harness runs locally in Node (`jsdom`) to evaluate:
1. **PII Detection**: Accuracy of detecting items matching strict regexes and field context (Precision, Recall, F1).
2. **Redaction**: Verifying that no True Positive text remains in the sanitized output. Over-redacted tricky negatives (False Positives) are recorded.
3. **End-to-End Latency**: The harness runs the agent loop 20 times (scan -> sanitize -> actual LLM `/plan` endpoint). Median and p95 latencies are captured for each distinct stage.
4. **Resource Usage**: Extracted via Node's `process.memoryUsage()` to approximate extension footprint.

## Honest Limitations
- **Synthetic Data**: The DOM fixtures are not as complex or deeply nested as a typical modern single-page application (SPA). Real-world performance (especially DOM scanning latency) will likely be slower.
- **Vision Model Context**: The evaluation harness operates strictly in Node, bypassing the actual ONNX Runtime Web execution (which runs on WebGPU/WASM in a real browser). Visual context accuracy is reported as `null` since it cannot be accurately measured without the real browser environment.
- **CPU Metrics**: CPU percentage is reported as `null` because tracking process CPU effectively for a browser extension across worker/content contexts via an automated script is not reliably measurable without external OS-level tools.
- **GPU Usage**: Browser extensions lack reliable standard APIs to inspect WebGPU VRAM usage dynamically, so GPU metrics remain marked as `N/A`.
