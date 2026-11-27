import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Office documents may be open in Word while Vite is running. Ignore them
  // so Windows file locks do not interrupt the development watcher.
  server: {
    watch: {
      ignored: ['**/*.docx', '**/*.doc'],
    },
  },
})
