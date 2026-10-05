import type { UIElement } from '../types';

let nextId = 1;
let scanNonce = '';
function generatePgId(): string {
  return `pg-${scanNonce}-${nextId++}`;
}

function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  return true;
}

export function scanDOM(): UIElement[] {
  nextId = 1; // reset for each scan
  scanNonce = Math.random().toString(36).substring(2, 8); // random nonce for each scan
  const elements: UIElement[] = [];
  
  // Define tags we care about for the AI
  const targetSelectors = 'input, textarea, select, button, a, form, img, h1, h2, h3, h4, h5, h6, p, label, span, div';
  const nodes = document.querySelectorAll(targetSelectors);

  nodes.forEach((node) => {
    const el = node as HTMLElement;
    
    // Skip hidden elements
    if (!isElementVisible(el)) return;

    // Filter out generic structural divs/spans that have no text and no actionable role
    if ((el.tagName === 'DIV' || el.tagName === 'SPAN') && !el.innerText.trim() && !el.onclick) {
      return;
    }
    
    // For text nodes (p, span, div, headings) that only contain text, we want to extract their text content
    // but not overwhelm if it's huge.
    const text = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') 
      ? (el as HTMLInputElement).value 
      : el.innerText;
      
    // If it's a structural element with no meaningful text/value and not a button/link/input, skip
    if ((el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'FORM') && !text.trim() && !el.getAttribute('aria-label')) {
       // Only keep form if it has important attributes, but we usually interact with inputs inside it
       if (el.tagName !== 'FORM') return; 
    }

    // Check if we've already processed this exact text via a child node to prevent duplicate text context
    // A simple heuristic: if a parent div has the same text as its child span, just take the child.
    if (el.children.length > 0 && el.tagName !== 'FORM' && el.tagName !== 'BUTTON' && el.tagName !== 'A') {
        // Just rough approximation: skip parent text nodes if they are just wrappers
        if (el.tagName === 'DIV' && el.innerText.trim() === (el.firstElementChild as HTMLElement)?.innerText.trim()) {
            return; 
        }
    }

    // Assign stable pg-id (always overwrite to prevent spoofing)
    const newPgId = generatePgId();
    el.setAttribute('data-pg-id', newPgId);
    const pgId = newPgId;

    const rect = el.getBoundingClientRect();

    const tag = el.tagName.toLowerCase();
    const typeAttr = el.getAttribute('type') || undefined;
    const inForm = !!(el.closest && el.closest('form'));
    const isSubmit = (tag === 'button' || tag === 'input') && (typeAttr === 'submit' || (tag === 'button' && !typeAttr));
    const isNav = !!(el.closest && el.closest('nav')) || tag === 'a';

    elements.push({
      pgId,
      tag,
      type: typeAttr,
      name: el.getAttribute('name') || undefined,
      id: el.getAttribute('id') || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      label: el.getAttribute('aria-label') || undefined,
      text: text.trim() ? text.trim() : undefined,
      isVisible: true,
      inForm: inForm ? true : undefined,
      isSubmit: isSubmit ? true : undefined,
      isNav: isNav ? true : undefined,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    });
  });

  return elements;
}
