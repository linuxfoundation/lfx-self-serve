// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defineConfig } from 'vitest/config';

// Scoped to src/server. App-side specs under src/app run through the `test` target in
// angular.json (`@angular/build:unit-test`), which compiles templates and boots jsdom;
// they are excluded here so each half runs in the environment it needs — plain Node for
// the server, a DOM for the app. `yarn test` runs both. Keep the two sets disjoint: a
// server spec picked up by the Angular builder pays for a browser it never uses, and an
// app spec picked up here fails on the missing compiler.
export default defineConfig({
  test: {
    include: ['src/server/**/*.spec.ts'],
    environment: 'node',
  },
});
