import { scanDOM } from './scanner';
import { sanitizeElement } from '../privacy/sanitizer';
import type { UIContext } from '../types';
import { executeAction } from './executor';
import { metrics } from '../privacy/metrics';

chrome.runtime.onMessage.addListener((request: any, _sender: any, sendResponse: any) => {
  if (request.action === 'EXECUTE_ACTION') {
    const startExec = performance.now();
    metrics.logEvent('ACTION_EXECUTING', { action: request.plan.action });
    executeAction(request.plan, request.secretValue).then((res) => {
      const endExec = performance.now();
      metrics.recordLatency('Action Execution', endExec - startExec);
      metrics.logEvent('ACTION_EXECUTED', { 
        success: res.success, 
        label: res.label || request.label || (request.plan.action === 'click' ? 'button' : request.plan.action) 
      });
      sendResponse(res);
    });
    return true;
  }

  if (request.action === 'SCAN_PAGE') {
    try {
      const startDom = performance.now();
      const elements = scanDOM();
      const endDom = performance.now();
      metrics.recordLatency('DOM Analysis', endDom - startDom);
      metrics.logEvent('DOM_SCANNED', { count: elements.length });

      const startSanitize = performance.now();
      const sanitizedElements = elements.map(el => sanitizeElement(el));
      const endSanitize = performance.now();
      metrics.recordLatency('Sanitization', endSanitize - startSanitize);
      
      const piiRects = sanitizedElements
        .filter(el => el.piiDetected.length > 0 && el.rect)
        .map(el => el.rect);

      metrics.logEvent('PII_DETECTED', { 
        elementsWithPII: piiRects.length,
        totalElements: elements.length
      });

      const context: UIContext = {
        url: window.location.href.split('?')[0],
        title: document.title,
        elements: sanitizedElements
      };
      
      sendResponse({ 
        success: true, 
        context,
        piiRects,
        devicePixelRatio: window.devicePixelRatio
      });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // async response
});
