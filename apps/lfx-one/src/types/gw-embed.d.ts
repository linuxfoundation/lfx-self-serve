// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Ambient declaration for the one global the embedded Gatewaze admin reads.
//
// The embed's build rewrites every `import.meta.env.VITE_X` in its sources to a bare
// `globalThis.__GATEWAZE_CONFIG__.X` — no optional chaining, because esbuild's `define` only
// accepts literals or identifier paths. So the host must populate this before the embed chunk
// evaluates, not merely before `mount()` runs (see GwModuleOutletComponent.setGwRuntimeConfig).
//
// Declared here rather than asserted at the assignment so the contract is greppable instead of
// hidden inside a cast. `tsconfig.app.json` picks this up through its `include` glob
// (`src/**/*.d.ts`) rather than a `typeRoots` entry, as an earlier version of this comment said, and the naming-convention rule is already disabled for `*.d.ts` — the
// name is fixed by the embed's build output and cannot be changed to satisfy it.

import type { GwRuntimeConfig } from '@lfx-one/shared/interfaces';

declare global {
  var __GATEWAZE_CONFIG__: GwRuntimeConfig | undefined;
}

export {};
