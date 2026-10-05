import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        offscreen: 'offscreen.html',
        dashboard: 'dashboard.html'
      }
    }
  },
  plugins: [
    react(),
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'models' // puts them in dist/models
        }
      ]
    })
  ],
});
