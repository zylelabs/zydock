export interface VolumeFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  modifiedAt?: string;
  readableAsText?: boolean;
}

export const useVolumeFiles = () => {
  const api = useApi();
  const session = useSessionStore();

  const base = (serverId: string, volume: string) =>
    `/organizations/${session.organizationId}/servers/${serverId}/volumes/${volume}/files`;

  const list = (serverId: string, volume: string, path: string) =>
    api.get<VolumeFileEntry[]>(base(serverId, volume), { query: { path } });

  const read = (serverId: string, volume: string, path: string) =>
    api.get<Blob>(`${base(serverId, volume)}/content`, { query: { path } });

  const write = (serverId: string, volume: string, path: string, content: string) =>
    api.put<{ message: string }>(`${base(serverId, volume)}/content`, {
      query: { path },
      body: content,
    });

  const createDirectory = (serverId: string, volume: string, path: string) =>
    api.post<{ message: string }>(`${base(serverId, volume)}/directory`, { body: { path } });

  const remove = (serverId: string, volume: string, path: string) =>
    api.del<{ message: string }>(base(serverId, volume), { query: { path } });

  const upload = (
    serverId: string,
    volume: string,
    path: string,
    file: File,
    onProgress?: (percent: number) => void,
  ) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const query = new URLSearchParams({ path });

      xhr.open('PUT', `/api/proxy${base(serverId, volume)}/content?${query.toString()}`);

      if (session.accessToken) {
        xhr.setRequestHeader('authorization', `Bearer ${session.accessToken}`);
      }

      xhr.upload.onprogress = event => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed'));

      xhr.send(file);
    });

  return { list, read, write, createDirectory, remove, upload };
};
