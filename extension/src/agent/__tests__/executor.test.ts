import { describe, it, expect, beforeEach } from 'vitest';
import { executeAction } from '../../content/executor';

describe('Executor Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('handles click action', async () => {
    document.body.innerHTML = '<button data-pg-id="btn-1">Click Me</button>';
    const btn = document.querySelector('button')!;
    let clicked = false;
    btn.onclick = () => { clicked = true; };

    const result = await executeAction({ action: 'click', target_id: 'btn-1' });
    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('handles type action with secret', async () => {
    document.body.innerHTML = '<input data-pg-id="input-1" />';
    const input = document.querySelector('input')!;
    
    const result = await executeAction({ action: 'type', target_id: 'input-1', value_ref: 'user_email' }, 'secret@test.com');
    expect(result.success).toBe(true);
    expect(input.value).toBe('secret@test.com');
  });

  it('fails if target_id is unknown', async () => {
    const result = await executeAction({ action: 'click', target_id: 'bad-id' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
