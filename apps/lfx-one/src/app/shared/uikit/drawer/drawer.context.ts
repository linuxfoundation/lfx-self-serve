// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UiDrawerSide } from '@lfx-one/shared/interfaces';

/**
 * Passed from `UiDrawerService` to the `lfx-ui-drawer` inside the drawer it opens: where it sits, how wide it is, and how its close button dismisses it. A drawer rendered without the service gets one with the defaults and an inert close button.
 */
export class UiDrawerContext {
  public constructor(
    public readonly side: UiDrawerSide = 'right',
    public readonly width: number = 600
  ) {}

  /** Set by the service: runs the `canClose` guard, then closes. */
  public requestClose: () => void = () => undefined;
}
