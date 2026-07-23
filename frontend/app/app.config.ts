export default defineAppConfig({
  icon: {
    customize: (content: string) => content.replace(/stroke-width="[^"]*"/g, 'stroke-width="1.75"'),
  },
});
