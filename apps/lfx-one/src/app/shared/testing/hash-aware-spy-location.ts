// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SpyLocation } from '@angular/common/testing';

/**
 * `SpyLocation` with the real `Location.path(includeHash)` contract: the `#fragment` is returned
 * only when asked for. `SpyLocation.path()` ignores the argument and always includes it, so a test
 * of code that must keep the fragment passes on it whether that code asks for the hash or not.
 *
 * Provide it as `{ provide: Location, useClass: HashAwareSpyLocation }`.
 */
export class HashAwareSpyLocation extends SpyLocation {
  public override path(includeHash = false): string {
    const path = super.path();
    return includeHash ? path : path.replace(/#.*$/, '');
  }
}
