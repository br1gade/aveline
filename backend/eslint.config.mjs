// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';

export default tseslint.config(
    // Build tooling: plain Node ESM, outside the TypeScript project service.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storage/**', '*.mjs', 'scripts/**'] },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Simplicity. These are the house style, see ../CLAUDE.md ──
      complexity: ['error', { max: 10 }],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'no-else-return': 'error',
      'prefer-const': 'error',
      'no-nested-ternary': 'error',

      // ── Naming. Intent must be readable without opening another file ──
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase'] },
        {
          // Booleans must read as assertions: isPublished, hasSeats, canEdit.
          // 'was' and 'were' are included for past-tense outcomes such as
          // wasClaimed, which read as assertions just as 'did' does.
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'did', 'will', 'was', 'were'],
        },
      ],

      // ── Async correctness. Unawaited promises are the main source of
      //    race conditions and lost errors in a Nest service. ──
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // ── Type honesty ──
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    },
  },

  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    ...jest.configs['flat/recommended'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      // Fixtures are allowed to be long and loosely typed; assertions are not.
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // supertest's .expect() is a real assertion; jest cannot see that.
      'jest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', '**.expect', 'request.**.expect'] },
      ],
      'jest/no-disabled-tests': 'error',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
    },
  },

  {
    // Decorator factories are PascalCase by NestJS convention — @Public(),
    // @RequirePermission(), @NormalizedEmail(). Scoped to the files that
    // define them so the rule still binds everywhere else.
    files: ['src/infra/auth/actor.ts', 'src/common/normalized-email.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
    },
  },

  {
    files: ['prisma/seed.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
