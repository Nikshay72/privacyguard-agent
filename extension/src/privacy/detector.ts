import type { PiiCategory, PiiDetection } from '../types';

const REGEX_PATTERNS: Record<PiiCategory, RegExp[]> = {
  EMAIL: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi],
  PHONE: [/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g],
  CREDIT_CARD: [/\b(?:\d{4}[-\s]?){3}\d{4}\b/g],
  CARD_EXPIRY: [/\b(0[1-9]|1[0-2])\/([0-9]{2}|[0-9]{4})\b/g],
  CVV: [],
  DATE_OF_BIRTH: [/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g],
  IDENTIFIER: [/\b\d{3}-\d{2}-\d{4}\b/g], // SSN format as an example
  PERSON: [], // Hard to do reliably with simple regex, rely on fields/context
  PASSWORD: [],
  ADDRESS: [] // Heuristics better for now
};

export function detectPII(text: string, context?: { type?: string, name?: string, id?: string, autocomplete?: string, ariaLabel?: string }): PiiDetection[] {
  const detections: PiiDetection[] = [];
  
  const attrString = context ? `${context.type || ''} ${context.name || ''} ${context.id || ''} ${context.autocomplete || ''} ${context.ariaLabel || ''}`.toLowerCase() : '';
  
  let fieldCategory: PiiCategory | null = null;
  if (context?.type === 'password' || attrString.includes('password') || attrString.includes('pass')) fieldCategory = 'PASSWORD';
  else if (attrString.includes('email')) fieldCategory = 'EMAIL';
  else if (attrString.includes('phone') || attrString.includes('mobile') || attrString.includes('tel')) fieldCategory = 'PHONE';
  else if (attrString.includes('address') || attrString.includes('street') || attrString.includes('city') || attrString.includes('zip') || attrString.includes('postal')) fieldCategory = 'ADDRESS';
  else if (attrString.includes('dob') || attrString.includes('birth')) fieldCategory = 'DATE_OF_BIRTH';
  else if (attrString.includes('ssn') || attrString.includes('passport') || attrString.includes('tax') || attrString.includes('national-id')) fieldCategory = 'IDENTIFIER';
  else if (attrString.includes('cvv') || attrString.includes('cvc') || attrString.includes('csc') || attrString.includes('cc-csc') || attrString.includes('security-code') || attrString.includes('security code')) fieldCategory = 'CVV';
  else if (attrString.includes('exp') || attrString.includes('expiry') || attrString.includes('cc-exp') || attrString.includes('expiration')) fieldCategory = 'CARD_EXPIRY';
  else if (attrString.includes('cc-name') || attrString.includes('cardholder') || attrString.includes('card-name') || attrString.includes('card_name')) fieldCategory = 'PERSON';
  else if (attrString.includes('cc-') || attrString.includes('card') || attrString.includes('credit') || attrString.includes('debit')) fieldCategory = 'CREDIT_CARD';
  else if (attrString.includes('name') && !attrString.includes('username')) fieldCategory = 'PERSON';

  if (!text) {
    if (fieldCategory) {
      detections.push({
        category: fieldCategory,
        confidence: 0.8,
        evidence: `field_context`,
        value: '',
        startIndex: 0,
        endIndex: 0
      });
    }
    return detections;
  }

  // Basic heuristics for PERSON/ADDRESS based on text content (e.g. "Name: John")
  const lower = text.toLowerCase();
  if (lower.startsWith('name:') || lower.startsWith('lives at')) {
    detections.push({
      category: 'PERSON',
      confidence: 0.7,
      evidence: 'heuristic',
      value: text,
      startIndex: 0,
      endIndex: text.length
    });
  } else if (lower.startsWith('address:')) {
    detections.push({
      category: 'ADDRESS',
      confidence: 0.7,
      evidence: 'heuristic',
      value: text,
      startIndex: 0,
      endIndex: text.length
    });
  }

  // 1. Regex-based detection
  for (const [categoryStr, patterns] of Object.entries(REGEX_PATTERNS)) {
    const category = categoryStr as PiiCategory;
    for (const regex of patterns) {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        detections.push({
          category,
          confidence: 0.9,
          evidence: 'regex_match',
          value: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
    }
  }

  // 2. Field context-based detection
  if (fieldCategory) {
    const hasOverlap = detections.some(d => d.startIndex <= text.length && d.endIndex >= 0);
    if (!hasOverlap) {
      detections.push({
        category: fieldCategory,
        confidence: 0.8,
        evidence: `field_context`,
        value: text,
        startIndex: 0,
        endIndex: text.length
      });
    }
  }

  return detections;
}
