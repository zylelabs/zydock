export default defineEventHandler(() => {
  const config = {
    environment: process.env.ENVIRONMENT,
  };

  return config;
});
