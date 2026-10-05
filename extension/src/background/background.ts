import { AgentLoop } from './loop';
import { metrics } from '../privacy/metrics';

// Background service worker
console.log('PrivacyGuard background service worker initialized.');

let currentAgent: AgentLoop | null = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log("PrivacyGuard Installed.");
  chrome.storage.local.set({
    vault: {
      user_email: "fake@example.com",
      user_name: "Jane Doe",
      user_phone: "555-0199",
      user_address: "123 Privacy St",
      user_cc: "4111222233334444",
      user_cvv: "123",
      user_expiry: "12/25"
    }
  });
});

let creating: Promise<void> | null = null;
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;
  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING], // Canvas operations and WASM
    justification: 'Running ONNX Runtime and canvas redaction'
  });
  await creating;
  creating = null;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (changeInfo.url && currentAgent && currentAgent.tabId === tabId) {
    if (currentAgent.state.url && changeInfo.url !== currentAgent.state.url) {
      if (currentAgent.state.status === 'DONE' || currentAgent.state.status === 'ERROR' || currentAgent.state.status === 'STOPPED') {
        currentAgent = null;
        chrome.storage.session.remove(['agentState', 'agentTabId', 'agentUrl']).catch(() => {});
        chrome.runtime.sendMessage({ action: 'AGENT_STATE_UPDATE', state: null }).catch(() => {});
      }
    }
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'START_AGENT') {
    if (currentAgent) currentAgent.stop();
    chrome.storage.session.remove(['agentState', 'agentTabId', 'agentUrl']).catch(() => {});
    currentAgent = new AgentLoop(request.tabId, request.goal, request.url);
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'STOP_AGENT') {
    if (currentAgent) currentAgent.stop();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'CONFIRM_ACTION') {
    if (currentAgent) currentAgent.confirmAction(request.approved);
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'GET_AGENT_STATE') {
    if (currentAgent && request.tabId && currentAgent.tabId !== request.tabId) {
      sendResponse({ state: null });
      return true;
    }
    if (currentAgent && request.url && currentAgent.state.url && currentAgent.state.url !== request.url) {
      if (currentAgent.state.status === 'DONE' || currentAgent.state.status === 'ERROR' || currentAgent.state.status === 'STOPPED') {
        sendResponse({ state: null });
        return true;
      }
    }
    sendResponse({ state: currentAgent ? currentAgent.state : null });
    return true;
  }

  if (request.action === 'CAPTURE_AND_REDACT') {
    (async () => {
      try {
        await setupOffscreenDocument();
        
        // Capture visible tab
        const windowId = request.windowId;
        const captureStart = performance.now();
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        metrics.recordLatency('Screen Capture', performance.now() - captureStart);
        
        // Send to offscreen for redaction
        const response = await chrome.runtime.sendMessage({
          action: 'PROCESS_SCREENSHOT',
          dataUrl,
          rects: request.rects,
          devicePixelRatio: request.devicePixelRatio
        });
        
        sendResponse({ ...response, originalDataUrl: dataUrl });
      } catch (err: any) {
        console.error("Error in CAPTURE_AND_REDACT", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});

