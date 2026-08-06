// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defineConfig } from 'vitest/config';

// Scoped to src/server: this app has no Angular test builder wired up (see angular.json),
// so component/template specs aren't supported here. Server-side specs run under plain
// Node with no Angular dependency, so they don't need one.
export default defineConfig({
  test: {
    include: ['src/server/**/*.spec.ts'],
    environment: 'node',
  },
});
