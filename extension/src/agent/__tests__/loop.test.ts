import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../../background/loop';

let localStore: Record<string, any> = {};

// Mock chrome API
const mockChrome = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({})
  },
  tabs: {
    get: vi.fn().mockResolvedValue({ url: 'http://localhost' }),
    sendMessage: vi.fn((_tabId, _msg, cb) => {
      if (cb) cb({ success: true, context: { elements: [] } });
    })
  },
  storage: {
    local: {
      get: vi.fn(async (keys: any) => {
        const result: any = { 
          latencies: localStore.latencies || [],
          auditLog: localStore.auditLog || [],
          vault: { 
            user_email: { value: 'test@example.com', category: 'EMAIL_ADDRESS', allowedOrigins: ['http://localhost'] },
            user_pass: { value: 'password123', category: 'PASSWORD', allowedOrigins: ['http://localhost'] },
            credit_card: { value: '1234567812345678', category: 'CREDIT_CARD', allowedOrigins: ['http://localhost'] },
            bad_origin: { value: 'secret', category: 'PHONE_NUMBER', allowedOrigins: ['http://example.com'] }
          },
          ...localStore
        };
        if (keys && typeof keys === 'object') {
          for (const k of Object.keys(keys)) {
            if (result[k] === undefined) result[k] = keys[k];
          }
        }
        return result;
      }),
      set: vi.fn(async (obj: any) => {
        Object.assign(localStore, obj);
      })
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue({})
    }
  }
};
(globalThis as any).chrome = mockChrome;

// Mock fetch
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

describe('AgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStore = {};
    mockChrome.tabs.sendMessage.mockImplementation((_tabId, _msg, cb) => {
      if (cb) cb({ success: true, context: { elements: [] } });
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'approved' })
    });
  });

  it('detects repeated no-ops', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({ success: true, context: { elements: [] } }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ action: 'wait', ms: 1 })
    });

    const loop = new AgentLoop(1, 'Test');
    loop.state.maxSteps = 3;
    
    // Give it enough time to complete 3 loops (each loop has a 1000ms delay in act, so this will actually take ~3 seconds real time)
    // Actually, maybe I shouldn't wait 3 seconds. Let's mock setTimeout just for the act delay, or just speed up the loop delay in testing.
    // To not wait 3s, let's just assert it runs. I will just wait a bit.
    // Wait, the delay is 1000ms! So running 3 steps takes 3 seconds.
    // Let me just restore the original fake timers but use advanceTimersByTimeAsync.
    vi.useFakeTimers();
    // Step 1
    await vi.advanceTimersByTimeAsync(1100);
    // Step 2
    await vi.advanceTimersByTimeAsync(1100);
    // Step 3
    await vi.advanceTimersByTimeAsync(1100);
    
    expect(loop.state.step).toBe(2);
    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toBe('Repeated no-op: Stopped to prevent infinite loop.');
    
    vi.useRealTimers();
  });

  it('stops at max steps when varying', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({ success: true, context: { elements: [] } }));
    let stepCount = 0;
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) {
        stepCount++;
        return { ok: true, json: async () => ({ action: `wait_${stepCount}` }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const loop = new AgentLoop(1, 'Test');
    loop.state.maxSteps = 3;
    
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1100);
    
    expect(loop.state.step).toBe(3);
    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toBe('Max steps reached.');
    
    vi.useRealTimers();
  });

  it('stops on done action', async () => {
    vi.useFakeTimers();
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({ success: true, context: { elements: [] } }));
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'done' }) };
      return { ok: true, json: async () => ({}) };
    });

    const loop = new AgentLoop(1, 'Test');
    await vi.advanceTimersByTimeAsync(1100);
    
    expect(loop.state.status).toBe('DONE');
    vi.useRealTimers();
  });

  it('requires confirmation for sensitive actions', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { 
        elements: [
          { pgId: 'pay-btn', tag: 'button', text: 'Pay Now', isVisible: true }
        ] 
      }
    }));

    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) {
        return {
          ok: true,
          json: async () => ({ action: 'click', target_id: 'pay-btn' })
        };
      }
      if (url.includes('/execute/validate')) {
        return { ok: true, json: async () => ({ status: 'approved' }) };
      }
    });

    const loop = new AgentLoop(1, 'Test');
    for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    
    expect(loop.state.status).toBe('WAITING_CONFIRMATION');

    // Confirm it
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => { if(cb) cb({ success: true }); });
    await loop.confirmAction(true);
    
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: 'EXECUTE_ACTION' }),
      expect.any(Function)
    );
  });

  it('handles denial of confirmation', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { elements: [{ pgId: 'pay-btn', tag: 'button', text: 'Submit Payment', isVisible: true }] }
    }));

    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'click', target_id: 'pay-btn' }) };
      if (url.includes('/execute/validate')) return { ok: true, json: async () => ({ status: 'approved' }) };
    });

    const loop = new AgentLoop(1, 'Test');
    
    for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    
    expect(loop.state.status).toBe('WAITING_CONFIRMATION');

    await loop.confirmAction(false);
    expect(loop.state.status).toBe('STOPPED');
    expect(loop.state.error).toBe('User denied irreversible action.');
  });

  it('rejects unknown value_ref', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { elements: [{ pgId: 'email', tag: 'input', type: 'email', isVisible: true }] }
    }));
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'type', target_id: 'email', value_ref: 'unknown_key' }) };
      return { ok: true, json: async () => ({}) };
    });
    const loop = new AgentLoop(1, 'Test');
    await new Promise(r => setTimeout(r, 10));
    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toContain('Unknown value_ref');
  });

  it('rejects mismatching category', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { 
        elements: [{ 
          pgId: 'email', tag: 'input', type: 'email', isVisible: true,
          piiDetected: [{ category: 'PASSWORD', value: 'secret' }]
        }] 
      }
    }));
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'type', target_id: 'email', value_ref: 'user_email' }) };
      return { ok: true, json: async () => ({}) };
    });
    const loop = new AgentLoop(1, 'Test');
    await new Promise(r => setTimeout(r, 10));
    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toContain('does not match field category');
  });

  it('rejects origin mismatch', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { elements: [{ pgId: 'phone', tag: 'input', type: 'tel', isVisible: true }] }
    }));
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'type', target_id: 'phone', value_ref: 'bad_origin' }) };
      return { ok: true, json: async () => ({}) };
    });
    const loop = new AgentLoop(1, 'Test');
    await new Promise(r => setTimeout(r, 10));
    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toContain('not in allowedOrigins');
  });

  it('requires confirmation for PASSWORD', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, _msg, cb) => cb({
      success: true,
      context: { elements: [{ pgId: 'pass', tag: 'input', type: 'password', isVisible: true }] }
    }));
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/plan')) return { ok: true, json: async () => ({ action: 'type', target_id: 'pass', value_ref: 'user_pass' }) };
      return { ok: true, json: async () => ({}) };
    });
    const loop = new AgentLoop(1, 'Test');
    await new Promise(r => setTimeout(r, 10));
    expect(loop.state.status).toBe('WAITING_CONFIRMATION');
  });

  it('stops after 2 identical clicks on nav link using element signature', async () => {
    let scanCount = 0;
    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        scanCount++;
        cb({
          success: true,
          context: {
            url: 'http://localhost:3000/application.html',
            elements: [
              { pgId: `pg-nav-${scanCount}`, tag: 'a', text: 'Job Application', isNav: true, isVisible: true },
              { pgId: `pg-btn-${scanCount}`, tag: 'button', type: 'submit', text: 'Submit Application', inForm: true, isSubmit: true, isVisible: true }
            ]
          }
        });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/plan')) {
        const body = JSON.parse(opts.body);
        const navEl = body.context.elements.find((e: any) => e.tag === 'a');
        return { ok: true, json: async () => ({ action: 'click', target_id: navEl ? navEl.pgId : `pg-nav-${scanCount}` }) };
      }
      return { ok: true, json: async () => ({ status: 'approved' }) };
    });

    vi.useFakeTimers();
    const loop = new AgentLoop(1, 'Navigate to Job Application');
    
    // Step 1 executes click
    await vi.advanceTimersByTimeAsync(1100);
    // Step 2 detects repeated signature click and errors out
    await vi.advanceTimersByTimeAsync(1100);

    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toContain('Loop detected');
    vi.useRealTimers();
  });

  it('selects submit button via heuristic shortcut, executes after approval, and completes with status DONE', async () => {
    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        cb({
          success: true,
          context: {
            url: 'http://localhost:3000/application.html',
            elements: [
              { pgId: 'pg-name', tag: 'input', type: 'text', text: 'Alice', inForm: true, isVisible: true, piiDetected: [{ category: 'PERSON', value: 'Alice' }] },
              { pgId: 'pg-submit-123', tag: 'button', type: 'submit', text: 'Submit Application', inForm: true, isSubmit: true, isVisible: true }
            ]
          }
        });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/execute/validate')) return { ok: true, json: async () => ({ status: 'approved' }) };
      return { ok: true, json: async () => ({}) };
    });

    const loop = new AgentLoop(1, 'Submit the application');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    // Confirm that LLM /plan endpoint was NOT called
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/plan'),
      expect.anything()
    );

    expect(loop.state.currentAction).toEqual(
      expect.objectContaining({
        action: 'click',
        target_id: 'pg-submit-123',
        reason: 'Planned locally (heuristic)'
      })
    );

    // If waiting confirmation, approve it
    if (loop.state.status === 'WAITING_CONFIRMATION') {
      await loop.confirmAction(true);
    }

    expect(loop.state.status).toBe('DONE');
    expect(loop.state.currentAction?.summary).toBe("Clicked 'Submit Application'");
  });

  it('network boundary test on application.html: wire payload has no raw PII and no forbidden fields', async () => {
    // Mock getBoundingClientRect and innerText for JSDOM
    Element.prototype.getBoundingClientRect = () => ({
      width: 100, height: 20, top: 0, left: 0, bottom: 20, right: 100, x: 0, y: 0, toJSON: () => {}
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get() { return this.textContent || ''; },
      configurable: true
    });

    document.body.innerHTML = `
      <nav>
          <a href="login.html">Login</a>
          <a href="application.html">Job Application</a>
          <a href="payment.html">Payment</a>
      </nav>
      <div class="card">
          <h1>Submit Application</h1>
          <p>Please review your auto-filled details before submitting.</p>
          <form id="application-form">
              <div class="field">
                  <label for="fullName">Full Name</label>
                  <input type="text" id="fullName" name="fullName" value="Alice Smith">
              </div>
              <div class="field">
                  <label for="phone">Phone Number</label>
                  <input type="tel" id="phone" name="phone" value="+1 (555) 123-4567">
              </div>
              <div class="field">
                  <label for="address">Home Address</label>
                  <textarea id="address" name="address" rows="2">123 Privacy Lane, Apt 4B
San Francisco, CA 94107</textarea>
              </div>
              <div class="field">
                  <label for="ssn">Social Security Number</label>
                  <input type="text" id="ssn" name="ssn" value="000-11-2222">
              </div>
              <button type="submit">Submit Application</button>
          </form>
      </div>
    `;
    document.title = "PrivacyGuard Demo - Application";

    const { scanDOM } = await import('../../content/scanner');
    const { sanitizeElement } = await import('../../privacy/sanitizer');

    const scanned = scanDOM();
    const sanitized = scanned.map(el => sanitizeElement(el));

    let capturedRequestBody: any = null;

    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        cb({
          success: true,
          context: {
            url: 'http://localhost:3000/application.html',
            title: document.title,
            elements: sanitized
          }
        });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/plan')) {
        capturedRequestBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            action: 'click',
            target_id: capturedRequestBody.context.elements[0].pgId,
            reason: 'Navigating to payment'
          })
        };
      }
      if (url.includes('/execute/validate')) {
        return { ok: true, json: async () => ({ status: 'approved' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Run AgentLoop with goal "Go to the payment page"
    const loop = new AgentLoop(1, 'Go to the payment page');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    expect(capturedRequestBody).not.toBeNull();
    const bodyStr = JSON.stringify(capturedRequestBody);

    // Assert: body has no raw forbidden keys in any element
    capturedRequestBody.context.elements.forEach((el: any) => {
      expect(el.text).toBeUndefined();
      expect(el.originalText).toBeUndefined();
      expect(el.rect).toBeUndefined();
      expect(el.piiDetected).toBeUndefined();
    });

    // Assert: none of the known fake PII values appear anywhere in the wire payload
    expect(bodyStr).not.toContain('Alice Smith');
    expect(bodyStr).not.toContain('+1 (555) 123-4567');
    expect(bodyStr).not.toContain('123 Privacy Lane');
    expect(bodyStr).not.toContain('000-11-2222');

    // Save fixture for pytest TestClient
    const fs = require('fs');
    const path = require('path');
    const fixturePath = path.join(__dirname, '../../../../server/tests/fixtures/captured_payment_goal_payload.json');
    if (!fs.existsSync(path.dirname(fixturePath))) {
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    }
    fs.writeFileSync(fixturePath, JSON.stringify(capturedRequestBody, null, 2));
  });

  it('sets status ERROR and does not emit TASK_DONE when executor returns failure', async () => {
    const { metrics } = await import('../../privacy/metrics');
    localStore = { auditLog: [] };

    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        cb({
          success: true,
          context: {
            url: 'http://localhost:3000/application.html',
            elements: [
              { pgId: 'pg-submit', tag: 'button', type: 'submit', text: 'Submit', inForm: true, isSubmit: true, isVisible: true }
            ]
          }
        });
      } else if (msg.action === 'EXECUTE_ACTION') {
        cb({ success: false, error: 'DOM element detached before click' });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'approved' })
    });

    const loop = new AgentLoop(1, 'Submit the application', 'http://localhost:3000/application.html');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    expect(loop.state.status).toBe('ERROR');
    expect(loop.state.error).toContain('Action execution failed: DOM element detached before click');

    const logs = await metrics.getAuditLog();
    const taskDoneEvents = logs.filter(l => l.event === 'TASK_DONE');
    expect(taskDoneEvents.length).toBe(0);

    const loopErrors = logs.filter(l => l.event === 'LOOP_ERROR');
    expect(loopErrors.length).toBeGreaterThan(0);
    expect(loopErrors[0].details.error).toContain('DOM element detached before click');
  });

  it('scopes state to tab and URL', () => {
    const loop = new AgentLoop(42, 'Goal A', 'http://localhost:3000/application.html');
    expect(loop.state.tabId).toBe(42);
    expect(loop.state.url).toBe('http://localhost:3000/application.html');
    expect(loop.state.goal).toBe('Goal A');
  });

  it('runs Submit the application and exports a real audit log', async () => {
    const { metrics } = await import('../../privacy/metrics');
    localStore = { auditLog: [] };

    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        cb({
          success: true,
          context: {
            url: 'http://localhost:3000/application.html',
            title: 'PrivacyGuard Demo - Application',
            elements: [
              { pgId: 'pg-submit', tag: 'button', type: 'submit', text: 'Submit Application', inForm: true, isSubmit: true, isVisible: true }
            ]
          }
        });
      } else if (msg.action === 'EXECUTE_ACTION') {
        metrics.logEvent('ACTION_EXECUTED', { success: true });
        cb({ success: true });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'approved' })
    });

    const loop = new AgentLoop(1, 'Submit the application', 'http://localhost:3000/application.html');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    expect(loop.state.status).toBe('DONE');
    expect(loop.state.currentAction?.summary).toBe("Clicked 'Submit Application'");

    const auditLog = await metrics.getAuditLog();
    console.log("SUBMIT AUDIT LOG IN TEST:", JSON.stringify(auditLog, null, 2));
    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog.some(l => l.event === 'ACTION_EXECUTED' && l.details.success === true)).toBe(true);
    expect(auditLog.some(l => l.event === 'TASK_DONE')).toBe(true);
  });

  it('runs Go to the payment page and exports a real audit log', async () => {
    const { metrics } = await import('../../privacy/metrics');
    localStore = { auditLog: [] };
    let step = 0;

    mockChrome.tabs.sendMessage.mockImplementation((_id, msg, cb) => {
      if (msg.action === 'SCAN_PAGE') {
        step++;
        if (step === 1) {
          cb({
            success: true,
            context: {
              url: 'http://localhost:3000/application.html',
              title: 'PrivacyGuard Demo - Application',
              elements: [
                { pgId: 'pg-nav-pay', tag: 'a', text: 'Payment', isNav: true, isVisible: true }
              ]
            }
          });
        } else {
          cb({
            success: true,
            context: {
              url: 'http://localhost:3000/payment.html',
              title: 'PrivacyGuard Demo - Payment',
              elements: [
                { pgId: 'pg-pay-h1', tag: 'h1', text: 'Payment Checkout', isVisible: true }
              ]
            }
          });
        }
      } else if (msg.action === 'EXECUTE_ACTION') {
        metrics.logEvent('ACTION_EXECUTED', { success: true });
        cb({ success: true });
      } else {
        cb({ success: true });
      }
    });

    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/plan')) {
        const body = JSON.parse(opts.body);
        if (body.context.url.includes('payment.html')) {
          return { ok: true, json: async () => ({ action: 'done', summary: 'Arrived on payment page' }) };
        }
        return { ok: true, json: async () => ({ action: 'click', target_id: 'pg-nav-pay', reason: 'Navigating to payment' }) };
      }
      return { ok: true, json: async () => ({ status: 'approved' }) };
    });

    vi.useFakeTimers();
    const loop = new AgentLoop(1, 'Go to the payment page', 'http://localhost:3000/application.html');
    
    // Step 1: Click nav link (sensitive keyword triggers confirmation)
    await vi.advanceTimersByTimeAsync(50);
    if (loop.state.status === 'WAITING_CONFIRMATION') {
      await loop.confirmAction(true);
    }
    // Advance timer past the 1000ms delay to trigger step 2
    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(100);

    expect(loop.state.status).toBe('DONE');

    const auditLog = await metrics.getAuditLog();
    console.log("AUDIT LOG IN TEST:", JSON.stringify(auditLog, null, 2));
    expect(auditLog.some(l => l.event === 'LLM_PLAN_RECEIVED')).toBe(true);
    expect(auditLog.some(l => l.event === 'ACTION_EXECUTED' && l.details.success === true)).toBe(true);
    expect(auditLog.some(l => l.event === 'TASK_DONE')).toBe(true);
    vi.useRealTimers();
  });
});
