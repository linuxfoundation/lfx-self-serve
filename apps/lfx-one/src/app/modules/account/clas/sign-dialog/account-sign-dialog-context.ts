// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WritableSignal } from '@angular/core';

/**
 * What the steps of the Account & Settings "Sign a CLA" dialog share (#6077). The dialog's host provides it to each step, which
 * injects it by this class rather than the host's, so the steps and the host don't import each other.
 */
export abstract class AccountSignDialogContext {
  /** The CLA group picked in the first step, which later steps name. */
  public abstract readonly pickedName: WritableSignal<string>;
}
