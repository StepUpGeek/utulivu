import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Utulivu',
        short_name: 'Utulivu',
        description: 'Hospitality management, works offline.',
        theme_color: '#16233B',
        background_color: '#F6F3ED',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        // Cache the app shell (HTML/CSS/JS) so the app loads with zero internet.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Never let the service worker try to cache/serve Supabase API calls —
            // those are handled by our own offline queue/cache logic instead.
            urlPattern: /supabase\.co/,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
})
