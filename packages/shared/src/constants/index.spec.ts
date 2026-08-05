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
// still does `export * from './utils'` and is plain-Node-hostile by design, so the second test below
// pins tailwind.config.js to the subpath import directly, rather than relying on this guard alone.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('constants barrel', () => {
  it('loads in a plain-Node environment', async () => {
    await expect(import('./index')).resolves.toBeTruthy();
  });
});

describe('tailwind.config.js', () => {
  it('does not import the plain-Node-hostile root @lfx-one/shared barrel', () => {
    const configPath = join(__dirname, '../../../../apps/lfx-one/tailwind.config.js');
    const source = readFileSync(configPath, 'utf-8');
    expect(source).not.toMatch(/from\s+['"]@lfx-one\/shared['"]/);
  });
});
