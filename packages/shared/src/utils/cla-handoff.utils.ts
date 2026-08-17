// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Sign CLA hand-off URL construction (#1251).

/**
 * Builds the Contributor Console decision-screen URL.
 *
 * Every rule here is one the Console imposes, not a choice:
 * - `claGroupId` and `claUserId` must be real — the Console fetches the project by the former
 *   and renders "invalid user ID in the URL" when the latter is absent.
 * - `redirectUrl` must be absolute and percent-encoded. Absolute because the final hop after
 *   signing is a server-side redirect that uses the stored value verbatim, so a relative path
 *   would resolve against the CLA API's origin instead of ours.
 * - It must ride *this* entry: only the decision screen reads `redirect` from the URL and
 *   persists it. Downstream Console screens read their own storage, never their URL.
 *
 * Note the corporate leg is the only consumer of `redirect`. The individual leg takes its
 * return address from the server-side in-progress-signature record instead, so a correct
 * URL here is necessary but not sufficient for that leg.
 */
export function buildConsoleHandoffUrl(consoleBaseUrl: string, claGroupId: string, claUserId: string, redirectUrl: string): string {
  // All four configured bases end with a slash today; normalize rather than depend on that.
  const base = consoleBaseUrl.replace(/\/+$/, '');

  return `${base}/#/cla/project/${encodeURIComponent(claGroupId)}/user/${encodeURIComponent(claUserId)}?redirect=${encodeURIComponent(redirectUrl)}`;
}
