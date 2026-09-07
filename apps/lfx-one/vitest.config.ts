// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Scoped to src/server. App-side specs under src/app run through the `test` target in
// angular.json (`@angular/build:unit-test`), which compiles templates and boots jsdom;
// they are excluded here so each half runs in the environment it needs — plain Node for
// the server, a DOM for the app. `yarn test` runs both. Keep the two sets disjoint: a
// server spec picked up by the Angular builder pays for a browser it never uses, and an
// app spec picked up here fails on the missing compiler.
export default defineConfig({
  resolve: {
    // Mirrors the tsconfig path alias so server specs exercise the real shared barrels
    // instead of drift-prone vi.mock stubs.
    alias: {
      // A deep source import the package's `exports` map doesn't publish; it resolves through
      // the tsconfig `@lfx-one/shared/*` path alias at build time. Mirrored here for specs.
      '@lfx-one/shared/constants/pdf.constants': fileURLToPath(new URL('../../packages/shared/src/constants/pdf.constants.ts', import.meta.url)),
      '@lfx-one/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
    },
  },
  test: {
    include: ['src/server/**/*.spec.ts'],
    environment: 'node',
  },
});
