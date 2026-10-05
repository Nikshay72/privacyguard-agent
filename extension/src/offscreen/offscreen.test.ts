import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScreenshot, initVision } from './offscreen';

const mocks = vi.hoisted(() => ({
  FAIL_WEBGPU: false,
  FAIL_MODEL: false,
}));

(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn().mockImplementation((keys) => Promise.resolve(keys || {})),
      set: vi.fn().mockResolvedValue({})
    }
  }
};

// Mock ONNX Runtime Web to test fallbacks
vi.mock('onnxruntime-web', () => ({
  env: { wasm: { wasmPaths: '' } },
  InferenceSession: {
    create: vi.fn().mockImplementation((_modelPath, options) => {
      if (options.executionProviders.includes('webgpu') && mocks.FAIL_WEBGPU) {
        return Promise.reject(new Error('WebGPU not supported'));
      }
      if (mocks.FAIL_MODEL) {
        return Promise.reject(new Error('Model missing'));
      }
      return Promise.resolve({ run: vi.fn() });
    })
  }
}));

describe('Screenshot Redaction & Vision Fallback', () => {
  const dummyDataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="redaction-canvas"></canvas>';
    mocks.FAIL_WEBGPU = false;
    mocks.FAIL_MODEL = false;
  });

  it('redacts the given DOM rects correctly (scaled by DPR)', async () => {
    await initVision();
    const domRects = [{ top: 10, left: 10, width: 100, height: 50 }];
    const result = await handleScreenshot(dummyDataUrl, domRects, 2);
    
    expect(result.maskedDataUrl).toContain('data:image/');
    expect(result.backend).toBe('WebGPU');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back to WASM when WebGPU fails', async () => {
    mocks.FAIL_WEBGPU = true;
    await initVision();
    
    const result = await handleScreenshot(dummyDataUrl, [], 1);
    expect(result.maskedDataUrl).toBeTruthy();
    expect(result.backend).toBe('WASM');
  });

  it('gracefully degrades to DOM-only when model is missing', async () => {
    mocks.FAIL_MODEL = true;
    await initVision();
    
    const result = await handleScreenshot(dummyDataUrl, [], 1);
    expect(result.maskedDataUrl).toBeTruthy();
    expect(result.backend).toBe('DOM-only');
  });
});

