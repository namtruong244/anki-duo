import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/drizzle/**',
      '.sst/**',
      'specs/**',
      '.claude/**',
      'sst.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', 'scripts/**', '**/scripts/**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly', console: 'readonly', process: 'readonly' } },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      // Constitution Principle I: the domain is pure. Time comes in as an argument.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Date.now() is forbidden in packages/domain: inject the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'new Date() without arguments is forbidden in packages/domain: inject the clock.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Math.random() is forbidden in packages/domain: pass randomness in.',
        },
      ],
    },
  },
);
