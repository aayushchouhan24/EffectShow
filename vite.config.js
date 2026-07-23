import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    glsl(),
    tailwindcss(),
    react()
  ]
})
