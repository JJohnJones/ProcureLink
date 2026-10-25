import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
  build: { rollupOptions: { output: { manualChunks: { deck: ['@deck.gl/react', '@deck.gl/layers'], basemap: ['maplibre-gl', 'react-map-gl/maplibre'] } } } },
});
