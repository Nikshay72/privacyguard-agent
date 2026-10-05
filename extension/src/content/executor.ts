import type { ActionPlan } from '../types';

export async function executeAction(action: ActionPlan, secretValue?: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (action.action === 'navigate') {
      if (action.url) {
        window.location.href = action.url;
        return { success: true };
      }
      return { success: false, error: 'No URL provided' };
    }

    if (action.action === 'wait') {
      await new Promise(r => setTimeout(r, action.ms || 1000));
      return { success: true };
    }

    if (action.action === 'scroll') {
      const amount = action.amount || 500;
      if (action.direction === 'down') window.scrollBy(0, amount);
      if (action.direction === 'up') window.scrollBy(0, -amount);
      if (action.direction === 'left') window.scrollBy(-amount, 0);
      if (action.direction === 'right') window.scrollBy(amount, 0);
      return { success: true };
    }

    // For click, type, select - we need a target
    if (!action.target_id) {
      return { success: false, error: 'No target_id provided' };
    }

    const el = document.querySelector(`[data-pg-id="${action.target_id}"]`) as HTMLElement;
    if (!el) {
      return { success: false, error: `Element with id ${action.target_id} not found on the current page` };
    }

    const label = el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value || el.getAttribute('name') || el.getAttribute('id') || '';

    if (action.action === 'click') {
      el.click();
      return { success: true, label: label.trim() };
    }

    if (action.action === 'type') {
      if (!secretValue) {
        return { success: false, error: 'No secret value provided for typing', label: label.trim() };
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        (el as HTMLInputElement).value = secretValue;
        // Dispatch events so React/Vue picks it up
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, label: label.trim() };
      } else {
        return { success: false, error: 'Target is not an input or textarea', label: label.trim() };
      }
    }

    if (action.action === 'select') {
      if (el.tagName === 'SELECT') {
        const select = el as HTMLSelectElement;
        const targetOption = action.option?.toLowerCase();
        let found = false;
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].text.toLowerCase() === targetOption || select.options[i].value.toLowerCase() === targetOption) {
            select.selectedIndex = i;
            found = true;
            break;
          }
        }
        if (found) {
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: `Option ${action.option} not found in select` };
      } else {
        return { success: false, error: 'Target is not a select element' };
      }
    }

    return { success: false, error: `Action ${action.action} not supported or implemented` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
