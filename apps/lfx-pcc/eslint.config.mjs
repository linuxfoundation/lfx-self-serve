import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';
import _import from 'eslint-plugin-import';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      'vite.config.ts',
      'projects/**/*',
      '**/*.spec.ts',
      '**/*-routing.module.ts',
      'src/main.ts',
      'src/polyfills.ts',
      'src/test.ts',
      'cypress/**/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/out-tsc/**',
      '**/.angular/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/deps_ssr/**',
    ],
  },
  ...fixupConfigRules(
    compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/eslint-recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:@angular-eslint/recommended',
      'plugin:import/typescript'
    )
  ).map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],

    plugins: {
      import: fixupPluginRules(_import),
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',

      parserOptions: {
        project: './tsconfig.app.json',
        createDefaultProgram: true,
      },
    },

    rules: {
      'no-forward-ref': 'off',
      'no-nested-ternary': 'error',
      '@angular-eslint/component-max-inline-declarations': 'error',
      '@angular-eslint/component-class-suffix': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@angular-eslint/no-output-on-prefix': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase', 'snake_case', 'PascalCase', 'UPPER_CASE'],
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'snake_case'],
        },
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: ['camelCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'typeProperty',
          format: ['camelCase', 'snake_case', 'PascalCase'],
        },
        {
          selector: 'objectLiteralProperty',
          format: ['PascalCase', 'camelCase', 'snake_case', 'UPPER_CASE'],
        },
      ],

      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'lfx',
          style: 'kebab-case',
        },
      ],

      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'lfx',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/no-attribute-decorator': 'error',
      '@angular-eslint/no-forward-ref': 'error',
      '@angular-eslint/no-lifecycle-call': 'error',
      '@angular-eslint/no-pipe-impure': 'error',
      '@angular-eslint/no-queries-metadata-property': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/use-component-selector': 'error',
      '@angular-eslint/use-component-view-encapsulation': 'error',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'class-methods-use-this': 'off',
      'import/no-extraneous-dependencies': 'off',
      'import/no-internal-modules': 'off',
      'import/no-unassigned-import': 'off',
      'no-constant-condition': 'off',
      'no-empty': 'error',
      'comma-dangle': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'warn',
      'no-console': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name!=/^(warn|error|info|trace)$/]",
          message: 'Only warn, error, info and trace allowed to be committed into code',
        },
      ],

      'max-len': [
        'error',
        {
          code: 160,
          ignoreUrls: true,
        },
      ],

      'no-else-return': 'error',
      'array-bracket-spacing': 'error',
      'block-spacing': [2, 'always'],

      'brace-style': [
        2,
        '1tbs',
        {
          allowSingleLine: true,
        },
      ],

      'comma-spacing': [
        2,
        {
          before: false,
          after: true,
        },
      ],

      'no-whitespace-before-property': 'error',
      radix: 'off',

      '@typescript-eslint/member-ordering': [
        2,
        {
          default: ['decorated-field', 'field', 'public-constructor', 'public-method', 'protected-method', 'private-method'],
        },
      ],
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@angular-eslint/no-empty-lifecycle-method': 'off',
      '@angular-eslint/no-output-native': 'off',
    },
  },
  ...fixupConfigRules(compat.extends('plugin:@angular-eslint/template/recommended')).map((config) => ({
    ...config,
    files: ['**/*.html'],
  })),
  {
    files: ['**/*.html'],

    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        project: './tsconfig.app.json',
      },
    },

    rules: {
      '@angular-eslint/template/cyclomatic-complexity': 'off',
    },
  },
  {
    files: ['**/*.d.ts'],

    rules: {
      '@typescript-eslint/naming-convention': 'off',
      'max-len': 'off',
    },
  },
  {
    files: ['**/config/styles/*.ts'],

    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
];
