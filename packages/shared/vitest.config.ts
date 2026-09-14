// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { defineConfig } from 'vitest/config';

/**
 * Package-local test scope for `yarn workspace @lfx-one/shared test` (plain Node vitest).
 * Required for correctness in the monorepo: when a package directory has no vitest config,
 * vitest walks UP and adopts the nearest ancestor config — the repo-root vitest.config.ts
 * guardrail — whose packages/** include doesn't resolve from this cwd, breaking the package's
 * own `vitest run`. Owning the scope here keeps package runs self-contained regardless of
 * ancestor configs.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
