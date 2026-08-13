export const useSession = () => {
  const endSession = () => {
    useSessionStore().clear();
    useRecentApplicationsStore().clear();
  };

  return {
    endSession,
  };
};
