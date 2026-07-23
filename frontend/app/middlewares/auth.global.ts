const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];

/**
 * Decides access on the client only: the session tokens live in `localStorage`, so during SSR there
 * is no way to know whether the visitor is signed in — the server would redirect everyone to the
 * login. The client hydrates the session store (persisted) before navigation, and the guard runs
 * there: no session sends protected routes to the login; an active session sends the auth screens
 * back to the interface.
 */
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
