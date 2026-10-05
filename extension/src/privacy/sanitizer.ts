import type { UIElement, SanitizedUIElement, PiiDetection, WirePayload, WireElement } from '../types';
import { detectPII } from './detector';

export function sanitizeText(text: string, detections: PiiDetection[]): string {
  if (!text || detections.length === 0) return text;

  // Sort detections by descending start index so replacing doesn't mess up offsets
  const sortedDetections = [...detections].sort((a, b) => b.startIndex - a.startIndex);
  
  let sanitized = text;
  for (const det of sortedDetections) {
    const before = sanitized.slice(0, det.startIndex);
    const after = sanitized.slice(det.endIndex);
    sanitized = `${before}[${det.category}]${after}`;
  }

  return sanitized;
}

export function sanitizeElement(element: UIElement): SanitizedUIElement {
  const context = { 
    type: element.type, 
    name: element.name, 
    id: element.id || element.name, 
    autocomplete: element.autocomplete,
    ariaLabel: element.label 
  };
  
  let detections: PiiDetection[] = [];
  let sanitizedText = element.text;
  let sanitizedLabel = element.label;

  const fieldDetections = detectPII(element.text || '', context);
  detections = detections.concat(fieldDetections);
  if (element.text) {
    sanitizedText = sanitizeText(element.text, fieldDetections);
  }

  if (element.name) {
    // We usually don't sanitize 'name' attribute completely as it's useful context, 
    // but we can sanitize if it literally contains a raw email etc. 
    // For now, let's just keep the name as is for the LLM to understand what the field is.
  }

  // If label contains PII
  if (element.label) {
    const labelDetections = detectPII(element.label);
    sanitizedLabel = sanitizeText(element.label, labelDetections);
    // don't necessarily need to add to total detections if it's just the label, 
    // but useful for metrics
  }

  return {
    ...element,
    originalText: element.text, // Kept locally
    sanitizedText,
    label: sanitizedLabel,
    piiDetected: detections
  };
}

function isSafeUIText(text?: string): boolean {
  if (!text) return false;
  const words = text.trim().split(/\s+/);
  if (words.length > 5) return false;
  if (/\d/.test(text)) return false;
  
  let consecutiveCaps = 0;
  for (let i = 1; i < words.length; i++) {
    // Check if word starts with a capital letter (non-first word)
    if (/^[A-Z]/.test(words[i])) {
      consecutiveCaps++;
      if (consecutiveCaps >= 2) return false;
    } else {
      consecutiveCaps = 0;
    }
  }
  return true;
}

export function toWirePayload(context: { url?: string, title?: string, elements: SanitizedUIElement[] }, goal?: string): WirePayload {
  let safeUrl = '';
  if (context.url) {
    try {
      const urlObj = new URL(context.url);
      const origin = urlObj.origin;
      const strippedPathname = urlObj.pathname.split('/').map(seg => {
        if (!seg) return seg;
        if (/\d/.test(seg) || seg.includes('@') || /^[A-Z][a-z]+(-[A-Z][a-z]+)*$/.test(seg)) return '[SEG]';
        return seg;
      }).join('/');
      safeUrl = origin + strippedPathname;
    } catch(e) {
      safeUrl = '[INVALID_URL]';
    }
  }

  const safeTitle = isSafeUIText(context.title) ? context.title : '[TEXT]';

  const isNavGoal = goal ? /\b(navigate|go to|open|visit|switch to|link)\b/i.test(goal) : true;

  const allowedTags = ['button', 'a', 'label', 'legend', 'option', 'th', 'h1', 'h2', 'h3'];

  const filteredElements = context.elements.filter(el => {
    if (!isNavGoal) {
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(el.tag)) return false;
      if (el.isNav || el.tag === 'a') return false;
    }
    return true;
  });

  const elements = filteredElements.map(el => {
    let wireText: string | undefined = undefined;
    
    // Default-deny text
    if (el.tag === 'input' || el.tag === 'textarea') {
      const isFilled = !!el.originalText;
      const categories = el.piiDetected?.map(d => d.category) || [];
      if (isFilled && categories.length > 0) {
        wireText = `[${categories[0]}_FILLED]`;
      } else if (isFilled) {
        wireText = '[FILLED]';
      } else {
        wireText = '[EMPTY]';
      }
    } else {
      // button, a, label, etc.
      if (allowedTags.includes(el.tag) && isSafeUIText(el.originalText)) {
        wireText = el.sanitizedText;
      } else if (el.originalText) {
        wireText = '[TEXT]';
      }
    }

    return {
      pgId: el.pgId,
      tag: el.tag,
      type: el.type,
      sanitizedText: wireText,
      label: el.label ? (isSafeUIText(el.label) ? el.label : '[TEXT]') : undefined,
      name: el.name,
      isVisible: el.isVisible,
      piiCategories: el.piiDetected?.map(d => d.category) || [],
      inForm: el.inForm ? true : undefined,
      isSubmit: el.isSubmit ? true : undefined,
      isNav: el.isNav ? true : undefined
    };
  });

  return { url: safeUrl, title: safeTitle, elements };
}
