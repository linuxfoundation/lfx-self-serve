// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Guards the constants barrel (this file's own directory) against Angular runtime code becoming
// reachable from it — whether via the '../utils' barrel or a direct file import to an
// Angular-touching utils file, e.g. form.utils.ts (@angular/forms) or meeting.utils.ts
// (@angular/common/http). Either one crashes any plain-Node evaluation of this barrel — Vitest
// here, but also jiti (apps/lfx-one's tailwind.config.js loads `@lfx-one/shared/constants`) — with
// a JIT-compiler error that surfaces far from its real cause (e.g. as an unrelated sass error on
// the global styles entry).
//
// Scope: this only covers the `/constants` subpath. The package root barrel
// (`packages/shared/src/index.ts`) still does `export * from './utils'` and is plain-Node-hostile
// by design — tailwind.config.js must stay on the `/constants` subpath import, not the bare
// `@lfx-one/shared` import, or this guard won't catch the regression.

import { describe, expect, it } from 'vitest';

describe('constants barrel', () => {
  it('loads in a plain-Node environment', async () => {
    await expect(import('./index')).resolves.toBeTruthy();
  });
});
