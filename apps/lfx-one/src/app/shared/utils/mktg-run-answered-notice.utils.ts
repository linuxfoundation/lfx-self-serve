// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The one line a browser hears when the questions it shows were answered by someone else, with its draft kept read-only
 * under it. Two ways to learn it: a send that lost (the server names the answerer, or the conflict path's fallback) and a
 * poll past the questions (the projection names nobody: the fallback, or "another window" when this profile's attempt
 * shows it answered the block elsewhere). A poll may also find the run already landed: then the asset is ready, not
 * being written; a send that lost never does, since the server answered while the run was still writing.
 */
export function mktgRunAnsweredElsewhereNotice(answeredBy: string | null, sameProfile = false, landed = false): string {
  const opening = sameProfile ? 'These were answered in another window' : `${answeredBy ?? 'Someone on your team'} already answered these`;
  return `${opening} — ${landed ? 'the asset is ready' : 'the agent is writing'}. Your draft is kept below.`;
}
