import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: [
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/icon',
    '@pinia/nuxt',
    'pinia-plugin-persistedstate/nuxt',
  ],
  vite: {
    plugins: [tailwindcss() as never],
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
    urlApi: 'http://localhost:8000',
    public: {
      wsUrl: '',
    },
  },
  app: {
    head: {
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  piniaPluginPersistedstate: {
    storage: 'localStorage',
  },
  fonts: {
    defaults: {
      weights: [300, 400, 500, 600, 700],
    },
  },
});
