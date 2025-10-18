import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactRefresh from 'eslint-plugin-react-refresh';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: ['dist'],
  },
  ...compat.config({
    extends: ['eslint:recommended'],
  }),
  ...compat.config({
    overrides: [
      {
        files: ['**/*.{ts,tsx,jsx,tsx}'],
        extends: ['plugin:react-hooks/recommended'],
      },
    ],
  }),
  ...compat.config({
    overrides: [
      {
        files: ['**/*.{ts,tsx}'],
        extends: ['plugin:@typescript-eslint/recommended-type-checked'],
      },
    ],
  }),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-refresh': reactRefresh,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
];
