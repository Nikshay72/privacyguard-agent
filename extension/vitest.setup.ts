// Setup canvas mock for JSDOM
import { vi } from 'vitest';

HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn()
}) as any;

HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockdata');

// Mock Image load
Object.defineProperty(Image.prototype, 'onload', {
  get() {
    return this._onload;
  },
  set(fn) {
    this._onload = fn;
    // Auto-trigger onload when src is set
    setTimeout(() => {
      if (this._onload) this._onload();
    }, 0);
  }
});

(globalThis as any).chrome = {
  runtime: {
    onMessage: {
      addListener: vi.fn()
    }
  }
};