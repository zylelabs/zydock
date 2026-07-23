export default defineNuxtRouteMiddleware(to => {
  if (to.path === '/' || !to.path.endsWith('/')) {
    return;
  }

  return navigateTo(
    { path: to.path.replace(/\/+$/, '') || '/', query: to.query, hash: to.hash },
    { redirectCode: 301 },
  );
});
