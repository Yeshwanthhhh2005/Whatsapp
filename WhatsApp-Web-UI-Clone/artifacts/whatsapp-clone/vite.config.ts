import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// Where the FastAPI backend is listening. Override with BACKEND_URL when it
// runs somewhere other than the default local port.
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';

const backendProxy = {
  '/api': { target: backendUrl, changeOrigin: true },
  // ws: true upgrades the connection rather than proxying it as plain HTTP.
  '/ws': { target: backendUrl, changeOrigin: true, ws: true },
  // Uploaded attachments are served by the backend's static mount.
  '/uploads': { target: backendUrl, changeOrigin: true },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Proxying keeps the browser on one origin: no CORS preflight in dev, and
    // WebSocket URLs stay same-origin so no absolute host has to be baked in.
    // Set VITE_API_URL instead to point the client straight at another origin.
    proxy: backendProxy,
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: backendProxy,
  },
});
