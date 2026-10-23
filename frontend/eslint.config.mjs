// @ts-check
//
// Frontend lint rules. The judgement rules are carried over from backend/eslint.config.mjs, so
// both halves of the repository read the same way; the client adds hooks, accessibility, a ban
// on float money and the feature boundaries (setup proposal §6, frontend/CLAUDE.md §6).
// Zero warnings: `npm run lint` runs with --max-warnings=0.
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      '.react-router/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'src/api/schema.ts',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  jsxA11y.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs', 'scripts/*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Simplicity, as on the backend ──
      complexity: ['error', { max: 10 }],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'no-else-return': 'error',
      'prefer-const': 'error',
      'no-nested-ternary': 'error',

      // ── Naming. Components are PascalCase functions; booleans read as assertions ──
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'did', 'will', 'was', 'were'],
        },
      ],

      // ── Async correctness ──
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // ── Type honesty ──
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],

      // ── Money is a string of minor units; never a float (docs/API.md §1) ──
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Money is minor units as a string: use src/lib/money.' },
      ],

      // ── Feature boundaries (setup proposal §7) ──
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // index.server.ts is a feature's server-only surface: loaders that must never reach
              // the browser bundle.
              group: ['@/features/*/*', '!@/features/*/index', '!@/features/*/index.server'],
              message: 'Import another feature only through its index.ts or index.server.ts.',
            },
          ],
        },
      ],
    },
  },

  {
    // Shared layers never reach into features.
    files: ['src/api/**', 'src/lib/**', 'src/ui/**', 'src/config/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/*'], message: 'api/, lib/ and ui/ never import from features/.' },
          ],
        },
      ],
    },
  },

  {
    // Tests and fixtures may be long; assertions stay typed.
    files: ['**/*.test.ts', '**/*.test.tsx', 'test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Build scripts are plain Node JavaScript, outside the TypeScript project.
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['scripts/**/*.mjs', '*.config.*', 'eslint.config.mjs'],
    rules: { 'max-lines-per-function': 'off' },
  },

  {
    // React Router calls the server entry with five arguments; the signature is not ours to change.
    files: ['src/entry.server.tsx'],
    rules: { 'max-params': 'off' },
  },
);
