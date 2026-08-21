export default defineNuxtPlugin(async () => {
  const session = useSessionStore();

  if (!session.accessToken) {
    await renewSession();
  }
});
