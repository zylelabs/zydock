import withNuxt from './.nuxt/eslint.config.mjs';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import prettierPlugin from 'eslint-plugin-prettier';

const ignores = ['*.md', '**/.config.ts'];

export default withNuxt({
  ignores,
  plugins: {
    prettier: prettierPlugin,
  },
  rules: {
    ...eslintConfigPrettier.rules,
    ...eslintPluginPrettierRecommended.rules,
    'vue/multi-word-component-names': 'off',
    'vue/no-multiple-template-root': 'off',
    'vue/require-prop-types': 'off',
    'vue/no-use-v-if-with-v-for': 'warn',
    'vue/no-v-html': 'off',
    'vue/valid-v-slot': ['error', { allowModifiers: true }],
  },
});
