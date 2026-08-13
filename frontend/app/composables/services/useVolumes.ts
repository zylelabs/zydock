export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  protected: boolean;
}

export const useVolumes = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/volumes`;

  const list = (serverId: string) => api.get<VolumeInfo[]>(base(serverId));

  const create = (serverId: string, name: string) =>
    api.post<VolumeInfo>(base(serverId), { body: { name } });

  const remove = (serverId: string, name: string) =>
    api.del<{ message: string }>(`${base(serverId)}/${name}`);

  return { list, create, remove };
};
