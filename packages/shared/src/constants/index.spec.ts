// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Guards the constants barrel against re-importing the '../utils' barrel, which re-exports
// form.utils.ts (@angular/forms) and meeting.utils.ts (@angular/common/http). Either one crashes
// any plain-Node evaluation of this barrel — Vitest here, but also jiti (apps/lfx-one's
// tailwind.config.js loads `@lfx-one/shared/constants`) — with a JIT-compiler error that surfaces
// far from its real cause (e.g. as an unrelated sass error on the global styles entry).

import { describe, expect, it } from 'vitest';

describe('constants barrel', () => {
  it('loads in a plain-Node environment', async () => {
    await expect(import('./index')).resolves.toBeTruthy();
  });
});
