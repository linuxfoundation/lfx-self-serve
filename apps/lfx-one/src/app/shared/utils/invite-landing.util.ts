// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isInviteLandingPath } from '@lfx-one/shared/utils';

/**
 * True when this browser document is the LFID invite landing or its error page.
 * Always false during SSR (`window` is undefined) — those initializers already no-op on the server.
 */
export function isBrowserInviteLandingPath(): boolean {
  return typeof window !== 'undefined' && isInviteLandingPath(window.location.pathname);
}
