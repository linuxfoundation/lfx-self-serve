// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { firstGrant } from './first-grant.helper';

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

describe('firstGrant', () => {
  it('settles on a granting check while another never settles', async () => {
    await expect(firstGrant([never<string | null>(), Promise.resolve('scope')])).resolves.toBe('scope');
  });

  it('answers null only once every check has answered without granting', async () => {
    await expect(firstGrant([Promise.resolve(null), Promise.resolve(null)])).resolves.toBeNull();
    await expect(firstGrant<string>([])).resolves.toBeNull();
  });

  it('does not answer null while a check is still pending', async () => {
    let settled = false;
    void firstGrant([Promise.resolve(null), never<string | null>()]).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
  });
});
