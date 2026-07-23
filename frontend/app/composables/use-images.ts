export interface ImageInfo {
  id: string;
  tag: string;
  sizeBytes: number;
  createdAt: string;
}

export const useImages = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (serverId: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/images`;

  const list = (serverId: string) => api.get<ImageInfo[]>(base(serverId));
  const pull = (serverId: string, reference: string) =>
    api.post<ImageInfo>(`${base(serverId)}/pull`, { body: { reference } });
  const remove = (serverId: string, reference: string) =>
    api.del<{ message: string }>(base(serverId), { query: { reference } });

  return { list, pull, remove };
};
