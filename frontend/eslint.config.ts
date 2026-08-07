import withNuxt from './.nuxt/eslint.config.mjs';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import prettierPlugin from 'eslint-plugin-prettier';

const ignores = ['*.md', '**/.config.ts', 'bun.lock'];

export default withNuxt(
  {
    ignores,
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...eslintConfigPrettier.rules,
      ...eslintPluginPrettierRecommended.rules,
      // 'vue/max-attributes-per-line': ['warn', { singleline: 5, multiline: 3 }],
      'vue/multi-word-component-names': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/require-prop-types': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/no-use-v-if-with-v-for': 'warn',
      'vue/no-v-html': 'off',
      'vue/valid-v-slot': [
        'error',
        {
          allowModifiers: true,
        },
      ],
    },
  },
  {
    files: ['app/pages/**/*.vue'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AwaitExpression > CallExpression[callee.name=/^(useAsyncData|useFetch)$/]',
          message:
            "Do not use await with useAsyncData/useFetch at the top level of a page's setup function—it suspends navigation. Use useLazyAsyncData/useLazyFetch without await instead.",
        },
      ],
    },
  },
);
