# PrivacyGuard Demo Script

This script walks through the end-to-end capabilities of PrivacyGuard in 6 distinct stages.

## Prerequisites
1. Ollama is running locally with `qwen2.5:3b-instruct` or `llama3.2:3b`.
2. The FastAPI server is running (`uvicorn app.main:app`).
3. The Chrome Extension is loaded.
4. The Demo Site is running (`npx serve .` in the `demo-site/` folder) on `http://localhost:3000`.

---

## Screen 1: The Raw Webpage (Unprotected)
1. Open the demo application form at `http://localhost:3000/application.html`.
2. Observe the page contains sensitive fields:
   - "Order number: 1800-555-1234" (Tricky negative)
   - Inputs for Email, Phone, and Credit Card.
3. Fill in the inputs with sample data (e.g., `test@example.com`, `(555) 123-4567`, `4111 1111 1111 1111`).

## Screen 2: Popup - Protection Status
1. Click the PrivacyGuard extension icon.
2. The **Status** tab shows:
   - Active Backend (WebGPU / WASM / DOM-only).
   - Counts of detected PII (e.g., 1 Email, 1 Phone, 1 Credit Card).

## Screen 3: Popup - Vision Redaction
1. Switch to the **Vision** tab in the popup.
2. You will see a side-by-side comparison:
   - **Original:** The raw screenshot of the page, clearly marked with a red **"Original screenshot: NEVER SENT"** badge.
   - **Masked:** The processed image where bounding boxes over sensitive text are blurred or blacked out.
3. **Talking point:** The original image is kept only in browser memory, never saved to disk, and discarded immediately after masking.

## Screen 4: Popup - Context Sanitization
1. Switch to the **Context** tab to view the `UIContext` JSON.
2. Observe the `elements` array.
3. Look for the `sanitizedText` properties. You should see `test@example.com` has been replaced with `[EMAIL]`.
4. Check that elements have stable `pg-id` attributes (e.g., `pg-12`).

## Screen 5: Agent Execution
1. Switch to the **Agent** tab.
2. Ensure the local vault has the necessary secrets configured (if required for typing).
3. Type the prompt: `"Submit the application"` and click **Start Agent**.
4. The agent status will cycle through:
   - *Observing...*
   - *Reasoning (LLM)...*
   - *Validating...*
   - *Executing...*
5. Because submitting an application might be flagged as an irreversible action by the server validator, a **Confirmation Dialog** should appear in the popup.
6. Click **Approve**. The page will submit.

## Screen 6: Metrics & Audit Dashboard
1. Click the **Dashboard** button in the popup to open the full-page dashboard (`dashboard.html`).
2. **E2E Harness Evaluation:** View the F1 scores and visual context accuracy pulled from the synthetic evaluation harness.
3. **Latency Pipeline:** Review the median and p95 latency timings for DOM scanning, sanitization, and the local LLM server response.
4. **Security Audit Log:** Scroll through the log to see timestamped records of every stage (Scan -> Detect -> Sanitize -> Validate -> Execute), confirming no raw PII was ever written to the log.
