// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Centralized augmentation of the browser `Window` type for third-party
// scripts that attach themselves to `window.*`. Add one entry per integration —
// individual services should import the underlying interface from
// `@lfx-one/shared/interfaces` and use it directly without redeclaring the
// global. `tsconfig.app.json` registers `src/types/` as a typeRoot, so this
// file is picked up automatically.

import type { IntercomFunction, IntercomSettings, LfxSegmentAnalyticsClass, PlausibleFunction } from '@lfx-one/shared/interfaces';

declare global {
  interface Window {
    LfxAnalytics?: { LfxSegmentsAnalytics: LfxSegmentAnalyticsClass };
    plausible?: PlausibleFunction;
    Intercom?: IntercomFunction;
    intercomSettings?: IntercomSettings;
  }
}

export {};
