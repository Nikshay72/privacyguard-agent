import type { AgentState, ActionPlan, UIContext, WirePayload } from '../types';
import { metrics } from '../privacy/metrics';
import { toWirePayload } from '../privacy/sanitizer';
import { formatErrorDetail, requestActionPlan } from '../api/client';

const API_BASE = 'http://127.0.0.1:8000';

export class AgentLoop {
  state: AgentState = {
    status: 'IDLE',
    step: 0,
    maxSteps: 10
  };
  tabId: number;
  lastContext?: UIContext;

  lastWirePayloadStr?: string;
  lastAction?: string;
  lastTargetId?: string;
  lastClickedSignature?: string;
  lastUrl?: string;
  lastActionPlan?: ActionPlan;

  constructor(tabId: number, goal: string, initialUrl?: string) {
    this.tabId = tabId;
    this.lastUrl = initialUrl;
    this.state = {
      status: 'OBSERVING',
      step: 0,
      maxSteps: 10,
      goal,
      tabId,
      url: initialUrl
    };
    metrics.logEvent('GOAL_STARTED', { goal });
    this.notifyPopup();
    this.run();
  }

  notifyPopup() {
    chrome.runtime.sendMessage({ action: 'AGENT_STATE_UPDATE', state: this.state }).catch(() => {});
    chrome.storage.session.set({ agentState: this.state, agentTabId: this.tabId, agentUrl: this.state.url }).catch(() => {});
  }

  stop() {
    if (this.state.status !== 'DONE' && this.state.status !== 'ERROR') {
      this.state.status = 'STOPPED';
      this.notifyPopup();
    }
  }

  async confirmAction(approved: boolean) {
    if (this.state.status !== 'WAITING_CONFIRMATION') return;
    if (approved) {
      this.state.status = 'EXECUTING';
      this.notifyPopup();
      await this.act(this.state.currentAction!);
    } else {
      this.state.status = 'STOPPED';
      this.state.error = 'User denied irreversible action.';
      this.notifyPopup();
    }
  }

  async run() {
    while (this.state.status === 'OBSERVING') {
      if (this.state.step >= this.state.maxSteps) {
        this.state.status = 'ERROR';
        this.state.error = 'Max steps reached.';
        this.notifyPopup();
        return;
      }

      this.state.step++;
      const stepStart = performance.now();
      
      try {
        // 1. OBSERVE (Sanitize happens in content script)
        this.state.status = 'OBSERVING';
        this.notifyPopup();
        
        const scanRes = await new Promise<any>((resolve) => {
          chrome.tabs.sendMessage(this.tabId, { action: 'SCAN_PAGE' }, resolve);
        });

        if (!scanRes || !scanRes.success) {
          throw new Error('Failed to scan page: ' + (scanRes?.error || 'No response'));
        }

        const context: UIContext = scanRes.context;
        this.lastContext = context;
        this.lastUrl = context.url;
        this.state.url = context.url;

        const isSubmitGoal = /submit/i.test(this.state.goal || '');

        // Generic completion check (only after an action has actually executed):
        if (this.lastActionPlan) {
          const hasSuccessMessage = context.elements.some(el => {
            const text = `${el.text || ''} ${el.label || ''} ${el.sanitizedText || ''}`.toLowerCase();
            return /(submitted|success|thank you|confirmation)/i.test(text);
          });

          const submitBtnPresent = context.elements.some(
            el => el.isSubmit || (el.tag === 'button' && (el.type === 'submit' || !el.type)) || (el.tag === 'input' && el.type === 'submit')
          );

          const wasSubmitClick = this.lastActionPlan?.action === 'click' && 
            (this.lastActionPlan.reason?.toLowerCase().includes('submit') || isSubmitGoal);

          if (hasSuccessMessage || (wasSubmitClick && !submitBtnPresent)) {
            this.state.status = 'DONE';
            this.state.currentAction = { action: 'done', summary: 'Goal completed successfully' };
            this.notifyPopup();
            metrics.logEvent('TASK_DONE', { summary: 'Goal completed successfully' });
            metrics.recordLatency('Total End-to-End', performance.now() - stepStart);
            return;
          }
        }

        const wirePayload = toWirePayload(context, this.state.goal);
        const wirePayloadStr = JSON.stringify(wirePayload);

        const isPayGoal = /(pay|buy|purchase|donate|order|checkout)/i.test(this.state.goal || '');

        // 2. REASON (Plan) - Deterministic shortcut or LLM
        let plan: ActionPlan | null = null;

        // Check if goal is a form submission and exactly one real submit button is available inside a form
        if (isSubmitGoal) {
          const submitElements = context.elements.filter(el => {
            if (!el.inForm) return false;
            const isSubmitType = el.isSubmit || el.type === 'submit' || (el.tag === 'input' && el.type === 'submit');
            if (!isSubmitType) return false;

            const text = `${el.sanitizedText || ''} ${el.label || ''} ${el.text || ''}`.toLowerCase();
            if (/(pay|buy|purchase|donate|order|checkout)/i.test(text) && !isPayGoal) {
              return false;
            }
            return true;
          });

          if (submitElements.length === 1) {
            const submitBtn = submitElements[0];
            plan = {
              action: 'click',
              target_id: submitBtn.pgId,
              reason: 'Planned locally (heuristic)'
            };
            metrics.recordLatency('Heuristic Planning', 0);
            metrics.logEvent('ACTION_PLANNED_LOCALLY', { 
              target_id: submitBtn.pgId, 
              reason: 'Planned locally (heuristic)',
              plan_source: 'heuristic',
              PLAN_SOURCE: 'heuristic'
            });
          }
        }

        if (!plan) {
          this.state.status = 'PLANNING';
          this.notifyPopup();
          
          const llmStart = performance.now();
          plan = await requestActionPlan(wirePayload, this.state.goal || '');
          const llmEnd = performance.now();
          metrics.recordLatency('LLM Planning', llmEnd - llmStart);
          metrics.logEvent('LLM_PLAN_RECEIVED', { 
            action: plan.action,
            plan_source: 'llm',
            PLAN_SOURCE: 'llm'
          });
        }

        this.state.currentAction = plan;

        if (plan.action === 'done') {
          this.state.status = 'DONE';
          metrics.logEvent('TASK_DONE', { summary: plan.summary || 'Task complete' });
          this.notifyPopup();
          metrics.recordLatency('Total End-to-End', performance.now() - stepStart);
          return;
        }
        
        if (this.lastAction === plan.action && this.lastTargetId === plan.target_id && this.lastWirePayloadStr === wirePayloadStr) {
           throw new Error('Repeated no-op: Stopped to prevent infinite loop.');
        }

        // 3. VALIDATE
        this.state.status = 'VALIDATING';
        this.notifyPopup();
        
        const valStart = performance.now();
        const valRes = await fetch(`${API_BASE}/execute/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plan)
        }).catch(err => { throw new Error(`Validation network error: ${err.message}`); });

        if (!valRes.ok) {
          const err = await valRes.json().catch(()=>({}));
          const detailMsg = err.detail ? formatErrorDetail(err.detail) : `Validation rejected action`;
          throw new Error(detailMsg);
        }
        metrics.recordLatency('Validation', performance.now() - valStart);
        metrics.logEvent('ACTION_VALIDATED', { action: plan.action });

        // Validate target_id exists locally
        let targetEl = undefined;
        if (plan.target_id) {
          targetEl = context.elements.find(el => el.pgId === plan.target_id);
          if (!targetEl) {
            throw new Error(`Security Exception: target_id ${plan.target_id} not found in last scanned context.`);
          }
        }

        // Loop Guard: Check element signature
        if (plan.action === 'click' && targetEl) {
          const elementSignature = `${targetEl.tag}|${targetEl.type || ''}|${targetEl.name || ''}|${targetEl.sanitizedText || targetEl.label || targetEl.text || ''}`;
          if (this.lastClickedSignature && this.lastClickedSignature === elementSignature) {
            throw new Error(`Loop detected: clicked identical element twice in a row (${elementSignature}).`);
          }
          this.lastClickedSignature = elementSignature;
        } else {
          this.lastClickedSignature = undefined;
        }

        this.lastAction = plan.action;
        this.lastTargetId = plan.target_id;
        this.lastWirePayloadStr = wirePayloadStr;
        this.lastUrl = context.url;
        this.lastActionPlan = plan;

        // Validate navigate allowlist
        if (plan.action === 'navigate' && plan.url) {
          try {
            const destUrl = new URL(plan.url);
            if (!['localhost:', '127.0.0.1:'].some(allow => destUrl.host.startsWith(allow))) {
                throw new Error(`Security Exception: Navigation to ${plan.url} blocked by allowlist.`);
            }
          } catch (e: any) {
             throw new Error(e.message || 'Invalid URL');
          }
        }

        // Check if action requires confirmation (irreversible or sensitive)
        let needsConfirmation = false;
        
        if (plan.action === 'click' && targetEl) {
          const btnText = (targetEl.text || targetEl.label || '').toLowerCase();
          if (/(pay|buy|order|purchase|confirm|donate|transfer)/.test(btnText)) {
            needsConfirmation = true;
          }
          if (targetEl.type === 'submit' && context.elements.some(e => e.piiDetected && e.piiDetected.length > 0)) {
            needsConfirmation = true;
          }
        } else if (plan.action === 'type' && plan.value_ref) {
           const storage = await chrome.storage.local.get('vault');
           const vault = (storage.vault || {}) as Record<string, any>;
           const vaultEntry = vault[plan.value_ref];
           
           if (!vaultEntry) {
             throw new Error(`Security Exception: Unknown value_ref ${plan.value_ref}`);
           }
           
           // Verify origin
           const tab = await chrome.tabs.get(this.tabId);
           const currentOrigin = new URL(tab.url || "http://localhost").origin;
           if (!vaultEntry.allowedOrigins || !vaultEntry.allowedOrigins.includes(currentOrigin)) {
               throw new Error(`Security Exception: Origin ${currentOrigin} not in allowedOrigins for ${plan.value_ref}`);
           }
           
           const expectedCategory = vaultEntry.category;
           if (expectedCategory === 'PASSWORD' || expectedCategory === 'CREDIT_CARD' || expectedCategory === 'CVV') {
              needsConfirmation = true;
           }
           if (targetEl && targetEl.piiDetected) {
             const fieldCategories = targetEl.piiDetected.map(d => d.category);
             if (fieldCategories.length > 0 && !fieldCategories.includes(expectedCategory)) {
                 throw new Error(`Security Exception: value_ref category ${expectedCategory} does not match field category [${fieldCategories.join(',')}]`);
             }
           }
        }

        if (needsConfirmation) {
          this.state.status = 'WAITING_CONFIRMATION';
          metrics.logEvent('WAITING_CONFIRMATION', { action: plan.action });
          this.notifyPopup();
          metrics.recordLatency('Total End-to-End (up to confirmation)', performance.now() - stepStart);
          return;
        }

        // 4. ACT
        this.state.status = 'EXECUTING';
        this.notifyPopup();
        await this.act(plan);
        metrics.recordLatency('Total End-to-End', performance.now() - stepStart);

      } catch (err: any) {
        this.state.status = 'ERROR';
        this.state.error = err.message;
        metrics.logEvent('LOOP_ERROR', { error: err.message });
        this.notifyPopup();
        return;
      }
    }
  }

  async act(plan: ActionPlan) {
    let secretValue = undefined;
    
    // Resolve secret from vault if typing
    if (plan.action === 'type' && plan.value_ref) {
      const storage = await chrome.storage.local.get('vault');
      const vault = (storage.vault || {}) as Record<string, any>;
      const vaultEntry = vault[plan.value_ref];
      secretValue = vaultEntry && typeof vaultEntry === 'object' ? vaultEntry.value : vaultEntry;
      if (!secretValue) {
        this.state.status = 'ERROR';
        this.state.error = `Could not resolve secret value_ref: ${plan.value_ref}`;
        this.notifyPopup();
        return;
      }
    }

    const targetEl = this.lastContext?.elements.find(el => el.pgId === plan.target_id);
    const targetLabel = targetEl?.sanitizedText || targetEl?.label || targetEl?.text || targetEl?.name || '';

    const execRes = await new Promise<any>((resolve) => {
      chrome.tabs.sendMessage(this.tabId, { 
        action: 'EXECUTE_ACTION', 
        plan, 
        secretValue,
        label: targetLabel
      }, resolve);
    });

    if (!execRes || !execRes.success) {
      this.state.status = 'ERROR';
      this.state.error = 'Action execution failed: ' + (execRes?.error || 'Unknown error');
      metrics.logEvent('LOOP_ERROR', { error: this.state.error });
      this.notifyPopup();
      return;
    }

    // 1. After a successful click that was planned by the submit heuristic, end the run with status DONE and dynamic summary
    const isSubmitGoal = /submit/i.test(this.state.goal || '');
    if (plan.action === 'click' && (plan.reason === 'Planned locally (heuristic)' || (isSubmitGoal && plan.reason?.toLowerCase().includes('submit')))) {
      const summary = `Clicked '${execRes.label || targetLabel || 'Submit'}'`;
      this.state.status = 'DONE';
      this.state.currentAction = {
        action: 'done',
        summary
      };
      metrics.logEvent('TASK_DONE', { summary });
      this.notifyPopup();
      return;
    }

    // Small delay to let DOM settle, then loop again
    setTimeout(() => {
      if (this.state.status === 'EXECUTING') {
        this.state.status = 'OBSERVING';
        this.run();
      }
    }, 1000);
  }
}
