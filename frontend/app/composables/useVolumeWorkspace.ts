import { useVolumeFiles, type VolumeFileEntry } from '~/composables/services/useVolumeFiles';

export interface VolumeWorkspaceOpenFile {
  path: string;
  name: string;
  content: string;
  original: string;
  loading: boolean;
  error: string;
  readableAsText: boolean;
}

const sortEntries = (entries: VolumeFileEntry[]) =>
  [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const isInside = (path: string, directory: string) =>
  path === directory || path.startsWith(`${directory}/`);

export const useVolumeWorkspace = (serverId: Ref<string>, volume: Ref<string>) => {
  const filesApi = useVolumeFiles();

  const tree = ref<Map<string, VolumeFileEntry[]>>(new Map());
  const expanded = ref<Set<string>>(new Set());
  const loadingDirs = ref<Set<string>>(new Set());

  const openFiles = ref<VolumeWorkspaceOpenFile[]>([]);
  const activePath = ref('');

  const loadDirectory = async (path: string) => {
    loadingDirs.value = new Set(loadingDirs.value).add(path);

    try {
      const entries = await filesApi.list(serverId.value, volume.value, path);
      const next = new Map(tree.value);

      next.set(path, sortEntries(entries));
      tree.value = next;
    } finally {
      const next = new Set(loadingDirs.value);

      next.delete(path);
      loadingDirs.value = next;
    }
  };

  const toggleDirectory = async (path: string) => {
    const next = new Set(expanded.value);

    if (next.has(path)) {
      next.delete(path);
      expanded.value = next;
      return;
    }

    next.add(path);
    expanded.value = next;

    if (!tree.value.has(path)) {
      await loadDirectory(path);
    }
  };

  const refreshDirectory = (path: string) => loadDirectory(path);

  const openFile = async (entry: VolumeFileEntry) => {
    const existing = openFiles.value.find(file => file.path === entry.path);

    if (existing) {
      activePath.value = entry.path;
      return;
    }

    const readableAsText = entry.readableAsText ?? true;

    const file: VolumeWorkspaceOpenFile = {
      path: entry.path,
      name: entry.name,
      content: '',
      original: '',
      loading: readableAsText,
      error: '',
      readableAsText,
    };

    openFiles.value = [...openFiles.value, file];
    activePath.value = entry.path;

    if (!readableAsText) {
      return;
    }

    try {
      const blob = await filesApi.read(serverId.value, volume.value, entry.path);
      const text = await blob.text();
      const current = openFiles.value.find(item => item.path === entry.path);

      if (current) {
        current.content = text;
        current.original = text;
      }
    } catch (error) {
      const current = openFiles.value.find(item => item.path === entry.path);

      if (current) {
        current.error = (error as { message?: string }).message || 'Failed to read the file.';
      }
    } finally {
      const current = openFiles.value.find(item => item.path === entry.path);

      if (current) {
        current.loading = false;
      }
    }
  };

  const isDirty = (path: string) => {
    const file = openFiles.value.find(item => item.path === path);

    return Boolean(file && file.content !== file.original);
  };

  const revert = (path: string) => {
    const file = openFiles.value.find(item => item.path === path);

    if (file) {
      file.content = file.original;
    }
  };

  const save = async (path: string) => {
    const file = openFiles.value.find(item => item.path === path);

    if (!file) {
      return;
    }

    file.error = '';

    try {
      await filesApi.write(serverId.value, volume.value, path, file.content);
      file.original = file.content;
    } catch (error) {
      file.error = (error as { message?: string }).message || 'Failed to save the file.';
    }
  };

  const forceCloseFile = (path: string) => {
    const index = openFiles.value.findIndex(file => file.path === path);

    if (index === -1) {
      return;
    }

    openFiles.value = openFiles.value.filter(file => file.path !== path);

    if (activePath.value === path) {
      const neighbor = openFiles.value[index] ?? openFiles.value[index - 1];

      activePath.value = neighbor?.path ?? '';
    }
  };

  const closeFile = (path: string) => {
    if (isDirty(path)) {
      return false;
    }

    forceCloseFile(path);

    return true;
  };

  const downloadFile = async (path: string, name: string) => {
    const blob = await filesApi.read(serverId.value, volume.value, path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const uploadFiles = async (
    directory: string,
    files: File[],
    onProgress?: (file: File, percent: number) => void,
  ) => {
    for (const file of files) {
      const target = directory ? `${directory}/${file.name}` : file.name;

      await filesApi.upload(serverId.value, volume.value, target, file, percent =>
        onProgress?.(file, percent),
      );
    }

    if (directory) {
      expanded.value = new Set(expanded.value).add(directory);
    }

    await refreshDirectory(directory);
  };

  const removePath = async (path: string) => {
    await filesApi.remove(serverId.value, volume.value, path);

    openFiles.value
      .filter(file => isInside(file.path, path))
      .forEach(file => forceCloseFile(file.path));

    const nextTree = new Map(tree.value);
    const nextExpanded = new Set(expanded.value);

    for (const key of [...nextTree.keys()]) {
      if (isInside(key, path)) {
        nextTree.delete(key);
      }
    }

    for (const key of [...nextExpanded]) {
      if (isInside(key, path)) {
        nextExpanded.delete(key);
      }
    }

    tree.value = nextTree;
    expanded.value = nextExpanded;

    await refreshDirectory(parentOf(path));
  };

  watch(volume, () => {
    tree.value = new Map();
    expanded.value = new Set();
    loadingDirs.value = new Set();
    openFiles.value = [];
    activePath.value = '';
  });

  return {
    tree,
    expanded,
    loadingDirs,
    openFiles,
    activePath,
    toggleDirectory,
    refreshDirectory,
    openFile,
    isDirty,
    revert,
    save,
    closeFile,
    forceCloseFile,
    downloadFile,
    uploadFiles,
    removePath,
  };
};
