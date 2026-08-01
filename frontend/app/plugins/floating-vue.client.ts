import FloatingVue, { Tooltip } from 'floating-vue';
import 'floating-vue/dist/style.css';

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.vueApp.use(FloatingVue, {
    themes: {
      clean: {
        $extend: 'tooltip',
        $resetCss: true,
      },
    },
  });
  nuxtApp.vueApp.component('Tooltip', Tooltip);
});
