export const PAYLOAD_SCHEMA_VERSION = "1.0.0";

export type PiiCategory = 
  | 'PERSON' 
  | 'EMAIL' 
  | 'PHONE' 
  | 'PASSWORD' 
  | 'ADDRESS' 
  | 'CREDIT_CARD' 
  | 'CARD_EXPIRY'
  | 'CVV'
  | 'DATE_OF_BIRTH' 
  | 'IDENTIFIER';

export interface PiiDetection {
  category: PiiCategory;
  confidence: number;
  evidence: string;
  value: string;
  startIndex: number;
  endIndex: number;
}

export interface UIElement {
  pgId: string;
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  label?: string;
  text?: string;
  isVisible: boolean;
  rect?: { top: number; left: number; width: number; height: number };
  inForm?: boolean;
  isSubmit?: boolean;
  isNav?: boolean;
}

export interface SanitizedUIElement extends UIElement {
  originalText?: string; // Only populated locally, never sent
  sanitizedText?: string;
  piiDetected: PiiDetection[];
}

export interface WireElement {
  pgId: string;
  tag: string;
  type?: string;
  name?: string;
  label?: string;
  sanitizedText?: string;
  isVisible: boolean;
  piiCategories: string[];
  inForm?: boolean;
  isSubmit?: boolean;
  isNav?: boolean;
}

export interface WirePayload {
  url: string;
  title: string;
  elements: WireElement[];
}

export interface UIContext {
  url: string;
  title: string;
  elements: SanitizedUIElement[];
}

export interface ActionPlan {
  action: 'click' | 'type' | 'scroll' | 'select' | 'navigate' | 'wait' | 'done';
  target_id?: string;
  value_ref?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  option?: string;
  url?: string;
  ms?: number;
  summary?: string;
  reason?: string;
}

export type AgentStatus = 'IDLE' | 'OBSERVING' | 'PLANNING' | 'VALIDATING' | 'WAITING_CONFIRMATION' | 'EXECUTING' | 'DONE' | 'ERROR' | 'STOPPED';

export interface AgentState {
  status: AgentStatus;
  step: number;
  maxSteps: number;
  currentAction?: ActionPlan;
  error?: string;
  goal?: string;
  tabId?: number;
  url?: string;
}