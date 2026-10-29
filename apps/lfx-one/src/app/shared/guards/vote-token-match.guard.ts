// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { VOTE_LINK_TOKEN_FRAGMENT_PARAM } from '@lfx-one/shared/constants';

/**
 * Matches the login-free vote link page only in the browser and only when the URL fragment carries a vote link
 * token (`/votes/:id#vote_token=...`, #4363). `canMatch` is not given the fragment, so it is read straight off
 * `window.location`; SSR never sees a fragment, so the server always falls through to the authenticated shell and
 * the browser re-matches on hydration. The value is only tested for presence here — never stored or logged.
 */
export const voteTokenMatchGuard: CanMatchFn = (_route, segments) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return false;
  }

  const id = segments[1]?.path;
  if (!id || id === 'create') {
    return false;
  }

  return new URLSearchParams(window.location.hash.replace(/^#/, '')).has(VOTE_LINK_TOKEN_FRAGMENT_PARAM);
};
