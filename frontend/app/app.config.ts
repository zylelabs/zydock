export default defineAppConfig({
  icon: {
    customize: (content: string) => {
      return content.replace(/stroke-width="[^"]*"/g, `stroke-width="2"`);
    },
  },
});
