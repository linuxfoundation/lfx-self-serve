// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Settles on the first check that grants, without waiting for the others; when none grants, waits
 * for every check and answers `null`. A check answers `null` for "does not grant" and must not
 * reject: settle failures into a value first, so the caller can still read them once nothing grants.
 *
 * Any one of several independent qualifications admits, so a stalled upstream must not delay a
 * caller another check has already admitted. A denial still waits for every check, because "none
 * grants" cannot be known earlier.
 */
export function firstGrant<T>(checks: Promise<T | null>[]): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let pending = checks.length;
    if (pending === 0) {
      resolve(null);
      return;
    }
    for (const check of checks) {
      check.then((granted) => {
        if (granted !== null) {
          resolve(granted);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      }, reject);
    }
  });
}
