const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

export default defineNuxtRouteMiddleware(to => {
  if (import.meta.server) {
    return;
  }

  const session = useSessionStore();
  const isPublic = PUBLIC_ROUTES.includes(to.path);

  if (!session.isAuthenticated && !isPublic) {
    return navigateTo('/login');
  }

  if (session.isAuthenticated && isPublic) {
    return navigateTo('/');
  }
});
