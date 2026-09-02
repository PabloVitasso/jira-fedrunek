import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/**', 'sync/**', 'sessions/**'],
  },

  // ── Lint directive hygiene ─────────────────────────────────────────────────
  // Unused eslint-disable comments become errors — prevents suppressions from
  // silently accumulating after the underlying issue is fixed.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // ── Base rules — all JS/MJS files ─────────────────────────────────────
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...prettierConfig.rules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ── Function length cap — src only ──────────────────────────────────────
  // JPL "Power of Ten" rule 4: no function longer than fits on one printed
  // page (~60 lines). Catches functions growing multiple responsibilities
  // before it becomes a review problem. Not applied to tests/node/**, where
  // setup/assertion bodies legitimately run longer.
  {
    files: ['src/**/*.js'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // ── Test globals — node:test ────────────────────────────────────────────
  {
    files: ['tests/node/**/*.test.js', 'tests/node/**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        test: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
];
