// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defineConfig } from 'vitest/config';

/**
 * Guardrail for bare `vitest` invocations from the monorepo ROOT (editor/agent test runners,
 * `npx vitest ...`): the hoisted root vitest binary's default globs otherwise collect specs it
 * cannot run —
 *
 *   - apps/lfx-one/src/app/** specs need the Angular unit-test builder (`yarn ng test`, the
 *     `test` target in apps/lfx-one/angular.json), which initializes the TestBed environment
 *     and jsdom; under plain vitest they fail with "Need to call TestBed.initTestEnvironment()".
 *   - apps/lfx-one/src/server/** specs need the `@lfx-one/shared` resolve aliases in
 *     apps/lfx-one/vitest.config.ts (`yarn test:server` from apps/lfx-one).
 *
 * Scoping root-level vitest to packages/** (whose specs are plain Node and run anywhere) turns
 * those misrouted runs into a correct "no test files found". Note vitest resolves config from
 * the invocation cwd, walking UP to the nearest config when the cwd has none — so each package
 * that runs plain vitest owns its scope: apps/lfx-one has its own vitest.config.ts, and
 * packages/shared carries one for exactly this reason. `yarn test`, `yarn test:server`,
 * `yarn ng test`, and `yarn workspace @lfx-one/shared test` are all unaffected by this file.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'apps/**'],
  },
});
