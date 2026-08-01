export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
}

export const useNetworks = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/networks`;

  const list = (serverId: string) => api.get<NetworkInfo[]>(base(serverId));

  const create = (serverId: string, name: string) =>
    api.post<NetworkInfo>(base(serverId), { body: { name } });

  const remove = (serverId: string, name: string) =>
    api.del<{ message: string }>(`${base(serverId)}/${name}`);

  return { list, create, remove };
};
