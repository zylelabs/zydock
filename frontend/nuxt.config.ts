import tailwindcss from '@tailwindcss/vite';

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
    },
  },
  app: {
    head: {
      title: 'Zydock',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
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
