// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';

import { isBrowserCredentialUrlPath } from './invite-landing.util';

describe('isBrowserCredentialUrlPath vote links (#4363)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it.each([
    ['/votes/v-1#vote_token=synthetic', true],
    ['/votes/v-1/#other=1&vote_token=synthetic', true],
    ['/votes/v-1', false],
    ['/votes/v-1#section', false],
    ['/votes/v-1/present#vote_token=synthetic', false],
    ['/meetings/m-1#vote_token=synthetic', false],
  ])('%s -> %s', (url, expected) => {
    window.history.replaceState(null, '', url);

    expect(isBrowserCredentialUrlPath()).toBe(expected);
  });
});
