// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
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
      'playwright.config.ts',
      'e2e/**/*',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended, tseslint.configs.stylistic, angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        project: './tsconfig.app.json',
      },
    },
    rules: {
      'no-nested-ternary': 'error',
      '@angular-eslint/component-max-inline-declarations': 'error',
      '@angular-eslint/component-class-suffix': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@angular-eslint/no-output-on-prefix': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        // Imports - can't control 3rd party names
        {
          selector: 'import',
          format: null,
        },
        // Destructured variables - often from APIs
        {
          selector: 'variable',
          modifiers: ['destructured'],
          format: null,
        },
        // Regular variables
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        // Parameters
        {
          selector: 'parameter',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        // Private members
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        // Types
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        // Type/interface properties - match API shapes
        {
          selector: 'typeProperty',
          format: null,
        },
        // Object literal properties - API payloads
        {
          selector: 'objectLiteralProperty',
          format: null,
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
      'no-constant-condition': 'off',
      'no-empty': 'error',
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
      'no-else-return': 'error',
      radix: 'off',
      '@typescript-eslint/member-ordering': [
        2,
        {
          default: ['decorated-field', 'field', 'public-constructor', 'public-method', 'protected-method', 'private-method'],
        },
      ],
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': 'warn',
      '@angular-eslint/no-empty-lifecycle-method': 'off',
      '@angular-eslint/no-output-native': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended],
    rules: {
      '@angular-eslint/template/cyclomatic-complexity': 'off',
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
  {
    files: ['**/config/styles/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
]);
