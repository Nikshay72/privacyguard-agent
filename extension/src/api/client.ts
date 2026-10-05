import { PAYLOAD_SCHEMA_VERSION, type WirePayload, type UIContext } from '../types';

const API_BASE = 'http://127.0.0.1:8000';

export function formatErrorDetail(detail: any): string {
  if (Array.isArray(detail)) {
    return detail
      .slice(0, 3)
      .map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          const loc = Array.isArray(item.loc)
            ? item.loc.filter((x: any) => x !== 'body').join('.')
            : item.loc;
          const field = loc || 'field';
          const msg = item.msg || item.message || JSON.stringify(item);
          return `${field}: ${msg}`;
        }
        return String(item);
      })
      .join('; ');
  }
  if (typeof detail === 'object' && detail !== null) {
    if (detail.msg || detail.message) {
      return detail.msg || detail.message;
    }
    return JSON.stringify(detail);
  }
  return String(detail);
}

export async function checkServerVersion(): Promise<{ ok: boolean; message?: string; serverVersion?: string }> {
  try {
    const response = await fetch(`${API_BASE}/version`);
    if (!response.ok) {
      return { ok: false, message: `Server error checking version (${response.status})` };
    }
    const data = await response.json();
    if (data.version !== PAYLOAD_SCHEMA_VERSION) {
      return {
        ok: false,
        serverVersion: data.version,
        message: "Server and extension versions do not match, update both"
      };
    }
    return { ok: true, serverVersion: data.version };
  } catch (err: any) {
    return {
      ok: false,
      message: "Cannot connect to local PrivacyGuard server on port 8000. Is it running?"
    };
  }
}

export async function requestActionPlan(context: WirePayload, goal: string): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, goal })
    });

    if (!response.ok) {
      let errorMsg = `Server error: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.detail) {
          errorMsg = formatErrorDetail(errorData.detail);
        }
      } catch (e) {}
      throw new Error(errorMsg);
    }

    return await response.json();
  } catch (err: any) {
    if (err.message && err.message.includes('Failed to fetch')) {
      throw new Error("Cannot connect to local PrivacyGuard server on port 8000. Is it running?");
    }
    throw err;
  }
}

export async function validateAction(action: any): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/execute/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action)
    });
    return response.ok;
  } catch (err) {
    console.error("Validation failed:", err);
    return false;
  }
}
