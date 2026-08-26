import { useHealth } from '~/composables/services/useHealth';

const DEFAULT_PANEL_NAME = 'Zydock';

export const usePanelName = () => {
  const panelName = useState<string>('panel-name', () => DEFAULT_PANEL_NAME);

  const { data } = useAsyncData('panel-name', () => useHealth().get(), { server: true });

  watch(
    () => data.value?.panelName,
    value => {
      if (value) {
        panelName.value = value;
      }
    },
    { immediate: true },
  );

  return { panelName };
};
