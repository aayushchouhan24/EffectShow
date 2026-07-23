import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    glsl(),
    tailwindcss(),
    react()
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('@mediapipe')) return 'vendor-mediapipe';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            if (id.includes('leva')) return 'vendor-leva';
            return 'vendor';
          }
        }
      }
    }
  }
})
