// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Scoped to src/server: this app has no Angular test builder wired up (see angular.json),
// so component/template specs aren't supported here. Server-side specs run under plain
// Node with no Angular dependency, so they don't need one.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@lfx-one/shared/constants', replacement: path.resolve(__dirname, '../../packages/shared/src/constants') },
      { find: '@lfx-one/shared/enums', replacement: path.resolve(__dirname, '../../packages/shared/src/enums') },
      { find: '@lfx-one/shared/interfaces', replacement: path.resolve(__dirname, '../../packages/shared/src/interfaces') },
      { find: '@lfx-one/shared/utils', replacement: path.resolve(__dirname, '../../packages/shared/src/utils') },
      { find: '@lfx-one/shared', replacement: path.resolve(__dirname, '../../packages/shared/src') },
    ],
  },
  test: {
    include: ['src/server/**/*.spec.ts'],
    environment: 'node',
  },
});
