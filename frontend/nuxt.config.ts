import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@nuxt/scripts',
    '@pinia/nuxt',
    'pinia-plugin-persistedstate/nuxt',
    'nuxt-toast',
  ],
  vite: {
    plugins: [tailwindcss() as never],
  },
  telemetry: {
    enabled: false,
  },
  devtools: { enabled: true, telemetry: false, timeline: { enabled: true } },
  css: ['~/assets/css/main.css'],
  dir: {
    app: 'app',
    public: 'public',
    middleware: 'middlewares',
  },
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],
  runtimeConfig: {
    public: {
      wsUrl: process.env.WS_URL ?? '',
      version: pkg.version,
    },
  },
  app: {
    head: {
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [{ rel: 'icon', href: '/favicon.ico' }],
      script: [
        {
          key: 'appearance',
          innerHTML: `(function () {
            try {
              var raw = localStorage.getItem('zydock:appearance');
              var mode = raw ? JSON.parse(raw).mode : 'system';
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              if (mode === 'dark' || (mode === 'system' && prefersDark)) {
                document.documentElement.classList.add('dark');
              }
            } catch (e) {}
          })();`,
        },
      ],
    },
  },
  piniaPluginPersistedstate: {
    storage: 'localStorage',
  },
  fonts: {
    defaults: {
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    },
  },
});
