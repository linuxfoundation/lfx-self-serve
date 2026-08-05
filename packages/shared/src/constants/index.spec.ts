// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// This is the single source of truth for the constants-barrel-must-stay-plain-Node invariant —
// utils files that reference it (activity-feed.utils.ts, date-time.utils.ts) point back here
// rather than restating it, so there is one place to keep in sync as the import graph changes.
//
// The invariant: nothing reachable from the constants barrel may import Angular runtime code —
// whether via the '../utils' barrel or a direct file import to an Angular-touching utils file,
// e.g. form.utils.ts (@angular/forms) or meeting.utils.ts (@angular/common/http). Either one
// crashes any plain-Node evaluation of this barrel — Vitest here, but also jiti, since
// apps/lfx-one's tailwind.config.js loads `@lfx-one/shared/constants` — with a JIT-compiler error
// that surfaces far from its real cause (e.g. as an unrelated sass error on the global styles
// entry). The two sanctioned constants->utils edges today are dashboard-metrics.constants.ts
// (color.utils, number.utils) and committees.constants.ts (committee.utils) — both Angular-free.
//
// This only covers the `/constants` subpath: the package root barrel (`packages/shared/src/index.ts`)
// still does `export * from './utils'` and is plain-Node-hostile by design — so is the `/utils`
// subpath itself. The second test below pins every `@lfx-one/shared*` specifier tailwind.config.js
// uses to exactly `/constants`, rather than just blocklisting the bare root import.
//
// That test reaches from packages/shared into apps/lfx-one via a relative filesystem read, which
// inverts the usual shared-package dependency direction. Deliberate: apps/lfx-one's Vitest config
// (`vitest.config.ts`) scopes `include` to `src/server/**/*.spec.ts`, so tailwind.config.js has no
// natural home for a spec of its own — this is the pragmatic alternative to widening that config.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('constants barrel', () => {
  it('loads in a plain-Node environment', async () => {
    await expect(import('./index')).resolves.toBeTruthy();
  });
});

describe('tailwind.config.js', () => {
  it('imports only the plain-Node-safe @lfx-one/shared/constants subpath', () => {
    const configPath = join(__dirname, '../../../../apps/lfx-one/tailwind.config.js');
    const source = readFileSync(configPath, 'utf-8');
    const specifiers = [...source.matchAll(/from\s+['"](@lfx-one\/shared[^'"]*)['"]/g)].map((m) => m[1]);

    // Fails loudly (not vacuously) if the import shape ever changes so much that no
    // @lfx-one/shared specifier is found at all — e.g. a codemod to require() or a dynamic import.
    expect(specifiers).not.toHaveLength(0);
    for (const specifier of specifiers) {
      expect(specifier).toBe('@lfx-one/shared/constants');
    }
  });
});
