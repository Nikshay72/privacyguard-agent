# PrivacyGuard Setup Guide

## Prerequisites
- Node.js (v18+)
- Chrome Browser
- Python 3.10+ (for later stages)

## Running the Demo Site
To run the demo site locally with a simple HTTP server:
```bash
cd demo-site
npx serve .
# Or use Python:
# python -m http.server 3000
```
Open `http://localhost:3000/login.html` in your browser.

## Building and Loading the Extension (Stage 1)
1. Install dependencies:
   ```bash
   cd extension
   npm install
   ```
2. Build the extension:
   ```bash
   npm run build
   ```
3. Load the unpacked extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable **Developer mode** in the top right corner.
   - Click **Load unpacked**.
   - Select the `extension/dist` folder.

## Usage (Stage 2)
1. Navigate to the local demo site (`http://localhost:3000/application.html`).
2. Click the PrivacyGuard extension icon.
3. The popup will automatically scan the page.
4. View the "Summary" tab to see counts of detected PII categories.
5. View the "JSON" tab to see the sanitized context.
6. View the "Vision" tab to see the locally generated masked screenshot (which blurs sensitive regions on the canvas). You will also see the active Backend (e.g., `DOM-only`, `WASM`, or `WebGPU`) and the latency.

## Usage (Stage 3)
1. Start the FastAPI server (requires Python 3.10+):
   ```bash
   cd server
   python -m venv venv
   # activate venv
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
2. Make sure Ollama is installed locally (https://ollama.com).
3. Pull the recommended model: `ollama pull qwen2.5:3b-instruct`. (Adjust `OLLAMA_MODEL` in `.env` if using a different one).
4. Run the extension, open the popup, and click the **Agent** tab.
5. Click **Test Plan Action**. The extension will hit `http://127.0.0.1:8000/plan` with your sanitized DOM and the backend will run it through Ollama, returning a structured JSON action plan.

## Usage (Stage 4)
1. In the extension popup, go to the **Agent** tab.
2. Ensure you are on the demo site (e.g., `http://localhost:3000/application.html`).
3. Set the Agent goal to "Submit the application" (or any other goal).
4. Click **Start Agent**.
5. The loop will transition through OBSERVING -> PLANNING -> ACTING -> DONE (up to 10 steps).
6. Irreversible actions (like payment) will enter `WAITING_CONFIRMATION` state where the popup displays an Approve/Deny button.
7. Unsafe actions (like `execute_script`) or off-origin navigations are blocked by the validator.

## Usage (Stage 5)
1. Build the extension (`npm run build` in `extension/` directory) and load it into Chrome.
2. Open the extension popup on any page (e.g. the demo site) and explore the newly added **Metrics** and **Audit** tabs.
3. **Metrics**: Real-time performance tracking.
   - Shows latency (in ms) across the agent loop: `capture_visible_tab`, `dom_analysis`, `llm_plan`, `action_validation`, and `e2e_loop`. 
   - Uses Chrome's `performance.memory` for RAM stats when available.
4. **Audit**: Complete security log.
   - All agent events (SCAN_PAGE, VALIDATE_ACTION, EXECUTE_ACTION, ERROR) are logged locally with timestamps.
   - Download the full JSON log using the **Export JSON** button.
5. **Dashboard**:
   - The popup provides a summary, but you can also view the full standalone metrics dashboard by clicking the "Open Dashboard" link or navigating to `chrome-extension://<id>/dashboard.html`.
   - The Vision tab explicitly confirms that the "Original screenshot" is NEVER SENT, while only the "Masked context" is available to the LLM.