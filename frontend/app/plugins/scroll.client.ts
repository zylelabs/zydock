export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.hooks.hook('page:finish', () => {
    const el = document.getElementById('scroll-container');
    if (el) {
      el.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  });
});
