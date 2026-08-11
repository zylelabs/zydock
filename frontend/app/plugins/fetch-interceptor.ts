export default defineNuxtPlugin(() => {
  const router = useRouter();
  const session = useSessionStore();
  const user = useUserStore();
  const publicRoutes = new Set([
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
  ]);

  const isPublicRoute = () => {
    const currentPath = router.currentRoute.value.path.replace(/\/+$/, '') || '/';

    return publicRoutes.has(currentPath);
  };

  globalThis.$fetch = $fetch.create({
    onRequest({ options }) {
      if (options.skipAuth) {
        return;
      }

      if (!session.isAuthenticated) {
        if (import.meta.client && !isPublicRoute()) {
          router.push('/auth/login');
        }

        return;
      }

      const headers = {
        ...options.headers,
        user: user?.email,
        Authorization: `Bearer ${session.accessToken}`,
      };

      options.headers = headers;
    },
    async onResponseError({ options, response }) {
      if (response?.status !== 401 || options.skipAuth || import.meta.server) {
        return;
      }

      if (await renewSession()) {
        return;
      }

      session.clear();

      if (!isPublicRoute()) {
        router.push('/auth/login');
      }
    },
  });
});
