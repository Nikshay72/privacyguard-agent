import { describe, it, expect } from 'vitest';
import { detectPII } from './detector';
import { sanitizeText, sanitizeElement, toWirePayload } from './sanitizer';
import type { UIElement } from '../types';

describe('PII Detector', () => {
  it('detects email addresses', () => {
    const text = 'My email is alice.smith@example.com, please contact me.';
    const detections = detectPII(text);
    expect(detections.length).toBe(1);
    expect(detections[0].category).toBe('EMAIL');
    expect(detections[0].value).toBe('alice.smith@example.com');
  });

  it('detects phone numbers', () => {
    const text = 'Call me at (555) 123-4567 tomorrow.';
    const detections = detectPII(text);
    expect(detections.length).toBe(1);
    expect(detections[0].category).toBe('PHONE');
    expect(detections[0].value).toBe('(555) 123-4567');
  });

  it('detects credit cards', () => {
    const text = 'Card: 4111 1111 1111 1111';
    const detections = detectPII(text);
    expect(detections.length).toBe(1);
    expect(detections[0].category).toBe('CREDIT_CARD');
  });

  it('detects PII from field context (heuristics)', () => {
    const detections = detectPII('Alice Smith', { type: 'text', name: 'fullName' });
    expect(detections.length).toBe(1);
    expect(detections[0].category).toBe('PERSON');
    expect(detections[0].value).toBe('Alice Smith');
  });
});

describe('PII Sanitizer', () => {
  it('replaces PII in raw text', () => {
    const text = 'Contact alice.smith@example.com or (555) 123-4567';
    const detections = detectPII(text);
    const sanitized = sanitizeText(text, detections);
    expect(sanitized).toBe('Contact [EMAIL] or [PHONE]');
  });

  it('sanitizes UIElements', () => {
    const el: UIElement = {
      pgId: 'pg-1',
      tag: 'input',
      type: 'password',
      name: 'user_pass',
      text: 'MySecret123!',
      isVisible: true
    };
    
    const sanitized = sanitizeElement(el);
    expect(sanitized.piiDetected.length).toBeGreaterThan(0);
    expect(sanitized.piiDetected[0].category).toBe('PASSWORD');
    expect(sanitized.sanitizedText).toBe('[PASSWORD]');
  });

  it('detects all 4 of 4 sensitive fields on payment.html and sanitizes without leaks', () => {
    const paymentElements: UIElement[] = [
      {
        pgId: 'pg-p1',
        tag: 'input',
        type: 'text',
        id: 'ccName',
        name: 'ccName',
        autocomplete: 'cc-name',
        text: 'Alice M Smith',
        isVisible: true
      },
      {
        pgId: 'pg-p2',
        tag: 'input',
        type: 'text',
        id: 'ccNumber',
        name: 'ccNumber',
        autocomplete: 'cc-number',
        text: '4111 1111 1111 1111',
        isVisible: true
      },
      {
        pgId: 'pg-p3',
        tag: 'input',
        type: 'text',
        id: 'ccExp',
        name: 'ccExp',
        autocomplete: 'cc-exp',
        text: '12/28',
        isVisible: true
      },
      {
        pgId: 'pg-p4',
        tag: 'input',
        type: 'text',
        id: 'ccCvv',
        name: 'ccCvv',
        autocomplete: 'cc-csc',
        text: '123',
        isVisible: true
      }
    ];

    const sanitizedElements = paymentElements.map(el => sanitizeElement(el));

    // Verify 4 of 4 sensitive field categories
    expect(sanitizedElements[0].piiDetected.some(d => d.category === 'PERSON')).toBe(true);
    expect(sanitizedElements[1].piiDetected.some(d => d.category === 'CREDIT_CARD')).toBe(true);
    expect(sanitizedElements[2].piiDetected.some(d => d.category === 'CARD_EXPIRY')).toBe(true);
    expect(sanitizedElements[3].piiDetected.some(d => d.category === 'CVV')).toBe(true);

    const wirePayload = toWirePayload({
      url: 'https://demo.local/payment.html',
      title: 'PrivacyGuard Demo - Payment',
      elements: sanitizedElements
    });

    const wireJson = JSON.stringify(wirePayload);
    // Assert no raw values leaked to wire
    expect(wireJson).not.toContain('Alice M Smith');
    expect(wireJson).not.toContain('4111 1111 1111 1111');
    expect(wireJson).not.toContain('12/28');
    expect(wireJson).not.toContain('123');

    // Assert wire placeholders exist
    expect(wirePayload.elements[0].sanitizedText).toBe('[PERSON_FILLED]');
    expect(wirePayload.elements[1].sanitizedText).toBe('[CREDIT_CARD_FILLED]');
    expect(wirePayload.elements[2].sanitizedText).toBe('[CARD_EXPIRY_FILLED]');
    expect(wirePayload.elements[3].sanitizedText).toBe('[CVV_FILLED]');
  });
});
