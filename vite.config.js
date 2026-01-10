import { defineConfig } from 'vite';

// Intentionally minimal: we keep hooks open for future multi-screen routing.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Local Ollama inference (avoids CORS by proxying through the Vite dev server).
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, '')
      }
    }
  },
  assetsInclude: [
    '**/*.mp3',
    '**/*.webp',
    '**/*.png',
    '**/*.jpg'
  ]
});
