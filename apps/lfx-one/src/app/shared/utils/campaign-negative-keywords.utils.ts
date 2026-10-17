// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS,
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE,
  CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN,
  KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES,
} from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordLastOutcome,
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordOutcome,
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordResult,
  CampaignNegativeKeywordsBatchOutcome,
  CampaignNegativeKeywordsRequestState,
  CampaignNegativeKeywordsResult,
  NegativeKeywordCampaignPlatform,
  RedditKeywordNegativeAction,
  RedditKeywordNegativeHolds,
  RedditKeywordNegativeTarget,
  RedditKeywordNotSentNote,
} from '@lfx-one/shared/interfaces';
import { parseNegativeKeywordInput } from '@lfx-one/shared/utils';

import { classifyCampaignWriteFailure } from './campaign-write-error.utils';

/**
 * Join each SENT negative keyword to the result at the same index.
 *
 * Positional by contract (`results[i]` answers `negativeKeywords[i]`, and the BFF never filters or
 * reorders them), so nothing here matches by text. An entry that is missing, or carries an outcome
 * this UI does not know, is UNCONFIRMED at its own position: the request reached the platform, so
 * "not added" cannot be claimed for it.
 */
export function negativeKeywordOutcomeRows(
  sent: readonly string[],
  matchType: CampaignNegativeKeywordMatchType,
  response: CampaignNegativeKeywordsResult | null | undefined,
  platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'
): CampaignNegativeKeywordOutcomeRow[] {
  const results: unknown[] = Array.isArray(response?.results) ? response.results : [];
  return sent.map((text, index) => {
    const entry = results[index] as Partial<CampaignNegativeKeywordResult> | null | undefined;
    const outcome =
      typeof entry?.outcome === 'string' && Object.hasOwn(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS, entry.outcome) ? entry.outcome : 'UNCONFIRMED';
    let detail = '';
    if (outcome === 'UNCONFIRMED') {
      detail = negativeKeywordUnconfirmedAdvice(platform);
    } else if (outcome === 'FAILED') {
      detail = negativeKeywordFailedDetail(platform, entry?.errorCode);
    }
    return { index, text, matchType, outcome, label: CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome], detail };
  });
}

/** What an UNCONFIRMED negative keyword tells the operator to do, naming the platform to check. */
export function negativeKeywordUnconfirmedAdvice(platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'): string {
  if (platform === 'microsoft-ads') {
    return CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE;
  }
  return `This keyword may or may not have been added. Check the campaign's negative keywords in ${CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].label} before retrying.`;
}

/**
 * Why a FAILED negative keyword was not added. Microsoft names its own machine-readable code.
 * Reddit and X answer only NOT_SENT or REJECTED (campaign-service never returns their text), so
 * those are worded here; any other code is not shown, since it is wire data with no meaning here.
 */
function negativeKeywordFailedDetail(platform: NegativeKeywordCampaignPlatform, errorCode: unknown): string {
  const label = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].label;
  const code = typeof errorCode === 'string' ? errorCode : '';
  if (platform === 'microsoft-ads') {
    return code !== '' ? `Microsoft Advertising error ${code}.` : 'Microsoft Advertising did not add it.';
  }
  if (code === 'NOT_SENT') {
    return `It was not sent to ${label}, so nothing changed.`;
  }
  if (code === 'REJECTED') {
    return `${label} refused it.`;
  }
  return `${label} did not add it.`;
}

/**
 * Classify a failed `POST /api/campaigns/:campaignId/negative-keywords`, which carries no
 * per-keyword results. No validator is sent, so there is no `conflict` state.
 *
 * - `failed` ONLY for a documented refusal (`KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES`: 400, 401,
 *   403, 404, 409) in the BFF's `{ error, code }` envelope, shown with the server's message: nothing
 *   was added.
 * - `unconfirmed` for everything else. The shared `classifyCampaignWriteFailure` already says so for
 *   a body that is not the BFF's envelope and for a message saying "unconfirmed" (keeping that
 *   message). Any OTHER failure it would call definite (a 5xx, a definite-sounding 503 included, a
 *   408, a 429) is unconfirmed here too, with `CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN`: the add
 *   was dispatched, and any of the keywords may have been added.
 */
export function campaignNegativeKeywordsFailureOutcome(error: unknown): CampaignNegativeKeywordsBatchOutcome {
  const outcome = classifyCampaignWriteFailure(error, {
    unconfirmed: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    failureFallback: CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  });
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (outcome.state === 'failed' && !KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES.has(status)) {
    return { state: 'unconfirmed', message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN };
  }
  return outcome;
}

/**
 * "2 added, 1 already present, 1 not confirmed" for one request, in outcome order. Counts of
 * keywords only. When any keyword is unconfirmed the verify-first advice is appended, because the
 * summary is what the toast carries past the editor.
 */
export function summarizeNegativeKeywordOutcomes(
  rows: readonly CampaignNegativeKeywordOutcomeRow[],
  platform: NegativeKeywordCampaignPlatform = 'microsoft-ads'
): string {
  const parts = (Object.keys(CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS) as CampaignNegativeKeywordOutcome[])
    .map((outcome) => ({ outcome, count: rows.filter((row) => row.outcome === outcome).length }))
    .filter(({ count }) => count > 0)
    .map(({ outcome, count }) => `${count} ${CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome].toLowerCase()}`);
  if (parts.length === 0) {
    return '';
  }
  const summary = parts.join(', ') + '.';
  return rows.some((row) => row.outcome === 'UNCONFIRMED') ? `${summary} ${negativeKeywordUnconfirmedAdvice(platform)}` : summary;
}

/**
 * The key a campaign's KEYWORD WRITES are serialized under: (project, campaign), independent of the
 * brief. The campaign UUID identifies the one upstream ad group / line item whose targeting both
 * keyword levers (negative-keyword add, keyword-targeting removal) write, while the brief id the page
 * holds can change under a write in flight (it goes empty during a Proceed save). Reservations,
 * pending-write holds and settle counters all use this key; per-brief keys
 * (`campaignNegativeKeywordsKey`) address only the outcomes shown.
 */
export function campaignKeywordWriteKey(projectSlug: string, campaignId: string): string {
  return `${projectSlug}|${campaignId}`;
}

/**
 * The key of one keyword's outcome high-water mark (`CampaignNegativeKeywordsService.keywordOutcomeSeqs`):
 * the campaign's `campaignKeywordWriteKey` plus the keyword as sent. Brief-independent, like the write key.
 */
export function keywordOutcomeSeqKey(projectSlug: string, campaignId: string, text: string): string {
  return `${campaignKeywordWriteKey(projectSlug, campaignId)}|${text}`;
}

/** The keyword-write key of a per-brief request key (`campaignNegativeKeywordsKey`). */
export function keywordWriteKeyOfRequestKey(requestKey: string): string {
  const [projectSlug, , campaignId] = requestKey.split('|');
  return campaignKeywordWriteKey(projectSlug ?? '', campaignId ?? '');
}

/** The keyword-write keys of every PENDING entry of a per-brief request map. */
export function pendingKeywordWrites(entries: Readonly<Record<string, { pending: boolean }>>): Record<string, true> {
  const pending: Record<string, true> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.pending) {
      pending[keywordWriteKeyOfRequestKey(key)] = true;
    }
  }
  return pending;
}

/**
 * The read-independent key of one Reddit keyword's not-sent note: (project, Reddit campaign id,
 * keyword as `redditNegativeKeywordText` sends it). A report row's own `key` carries its index in
 * one read, so it does not survive a re-read that re-ranks the rows. Two rows of one report that
 * send the same text for the same campaign share the note, and both show it.
 */
export function redditKeywordNoteKey(projectSlug: string, redditCampaignId: string, text: string): string {
  return `${projectSlug}|${redditCampaignId}|${text}`;
}

/**
 * Whether a Reddit keyword's not-sent note may still be shown — the ONE rule for a note on a row and
 * a note listed above the table:
 * - only under the project it was recorded for (the table stays mounted across a project change);
 * - only for the keyword read current when it was recorded (a Refresh, Retry or window change after
 *   it clears it);
 * - only while the keyword has no NEWER write outcome than when it was recorded: a later add of it,
 *   from the table or the editor, supersedes it, for good (`redditKeywordNoteSuperseded`).
 */
export function redditKeywordNoteShowable(
  note: RedditKeywordNotSentNote,
  current: { projectSlug: string; readId: string; latestKeywordSeq: number | undefined }
): boolean {
  if (note.projectSlug !== current.projectSlug || note.read !== current.readId) {
    return false;
  }
  return !redditKeywordNoteSuperseded(note, current.latestKeywordSeq);
}

/**
 * Whether a newer write outcome of the note's keyword has settled since the note was recorded.
 *
 * Reads `latestKeywordSeq`, the keyword's outcome HIGH-WATER mark in
 * `CampaignNegativeKeywordsService.keywordOutcomeSeqs` (`undefined` when it never had one), never
 * the outcomes on display: those can be dismissed or dropped by a scope change, the high-water mark
 * cannot. So dismissing an OLDER result keeps the note, and dismissing the NEWER one that hid it does
 * not bring it back.
 */
export function redditKeywordNoteSuperseded(note: RedditKeywordNotSentNote, latestKeywordSeq: number | undefined): boolean {
  return latestKeywordSeq !== undefined && latestKeywordSeq > note.outcomeSeq;
}

/**
 * Whether two (project, brief) scopes of the negative-keyword lever are the same. An EMPTY brief id
 * on either side matches any brief of the same project: the campaigns page's brief id goes empty
 * while a Proceed save runs, and stays empty after a failed one, and neither is a switch to another
 * brief. Only a different project, or a different real brief id, is another scope.
 */
export function negativeKeywordsScopesMatch(projectA: string, briefA: string, projectB: string, briefB: string): boolean {
  return projectA === projectB && (briefA === '' || briefB === '' || briefA === briefB);
}

/**
 * The key one campaign's negative-keyword request is held under: (project, brief, campaign), so a
 * request can never render against another project's or brief's campaign. The separator cannot
 * occur in a project slug, a brief id or a campaign id.
 */
export function campaignNegativeKeywordsKey(projectSlug: string, briefId: string, campaignId: string): string {
  return `${projectSlug}|${briefId}|${campaignId}`;
}

/**
 * Each keyword's last outcome after one settled request, merged over the earlier ones: the
 * keywords of this request take their new outcome (by POSITION in what was sent, or the batch's
 * outcome when there were no per-keyword results), every other keyword keeps its own. `seq` stamps
 * the new outcomes: the caller passes a number greater than any it passed before.
 */
export function mergeNegativeKeywordLastOutcomes(
  previous: Readonly<Record<string, CampaignNegativeKeywordLastOutcome>>,
  sent: readonly string[],
  rows: readonly CampaignNegativeKeywordOutcomeRow[],
  batchOutcome: CampaignNegativeKeywordsBatchOutcome | null,
  seq: number
): Record<string, CampaignNegativeKeywordLastOutcome> {
  const next: Record<string, CampaignNegativeKeywordLastOutcome> = { ...previous };
  sent.forEach((text, index) => {
    if (batchOutcome !== null) {
      const outcome: CampaignNegativeKeywordOutcome = batchOutcome.state === 'unconfirmed' ? 'UNCONFIRMED' : 'FAILED';
      next[text] = { outcome, label: CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS[outcome], detail: batchOutcome.message, seq };
      return;
    }
    const row = rows[index];
    if (row !== undefined) {
      next[text] = { outcome: row.outcome, label: row.label, detail: row.detail, seq };
    }
  });
  return next;
}

/**
 * The text a Reddit keyword-report row would be sent as through `add-negative-keywords`: the
 * keyword parsed exactly as the negative-keyword editor parses a line (whitespace collapsed, the
 * lever's length and character rules applied). `null` when the row has no keyword or the lever
 * would refuse its text, so no action is offered for it.
 */
export function redditNegativeKeywordText(keyword: string | null): string | null {
  if (keyword === null || keyword.includes('\n') || keyword.includes('\r')) {
    return null;
  }
  const parsed = parseNegativeKeywordInput(keyword);
  return parsed.problems.length === 0 && parsed.keywords.length === 1 ? parsed.keywords[0] : null;
}

/**
 * Where one Reddit keyword row's "Add as negative" stands, from the campaign's latest request in
 * `CampaignNegativeKeywordsService` (shared with the campaign's own negative-keyword editor).
 *
 * The keyword's outcome is its LAST one on the campaign (`keywordOutcomes`, built by POSITION in
 * what each request sent — never by the text a response echoed), so a later request for other
 * keywords does not erase it. The sent lists were parsed exactly as `redditNegativeKeywordText`
 * parses the row, so the two compare as equal strings.
 *
 * `busy` while the campaign's request is in flight, the table holds it for a revision read, or a
 * keyword-targeting removal of it is in flight (its Reddit targeting is one domain).
 *
 * `negative` only for a CONFIRMED outcome (added or already present). Reddit offers no read of a
 * campaign's excluded keywords, so a negative this session did not confirm is not known here; the
 * button stays offered, and upstream answers ALREADY_PRESENT without sending it again.
 *
 * `notSentMessage` is the table's own latest attempt for this keyword that went nowhere; the caller
 * passes it only while the keyword has no newer write outcome, and it is shown alongside that outcome
 * — also when no action is offered any more (the campaign left the targets while the add was pending).
 */
export function redditKeywordNegativeAction(
  keyword: string | null,
  target: RedditKeywordNegativeTarget | null,
  request: CampaignNegativeKeywordsRequestState | null,
  holds: RedditKeywordNegativeHolds,
  notSentMessage = ''
): RedditKeywordNegativeAction {
  const none: RedditKeywordNegativeAction = {
    state: 'none',
    sending: false,
    ariaLabel: '',
    outcomeLabel: '',
    outcomeDetail: '',
    outcomeTone: 'none',
    notSentMessage: '',
  };
  const text = redditNegativeKeywordText(keyword);
  if (text === null || target === null) {
    // No action is offered (e.g. the campaign left the targets mid-add), but an add the operator
    // confirmed that went nowhere is still said: it is never dropped silently.
    return text === null ? none : { ...none, notSentMessage };
  }
  // The visible label first, so speech input ("click Add as negative") still matches.
  const ariaLabel = `Add as negative: ${text} (${target.campaignName})`;
  if (request?.pending) {
    return { ...none, state: 'busy', sending: request.sent.includes(text), ariaLabel };
  }
  const last = request === null || !Object.hasOwn(request.keywordOutcomes, text) ? null : request.keywordOutcomes[text];
  if (last !== null && (last.outcome === 'APPLIED' || last.outcome === 'ALREADY_PRESENT')) {
    return { ...none, state: 'negative', outcomeLabel: last.label };
  }
  const outcome: Pick<RedditKeywordNegativeAction, 'outcomeLabel' | 'outcomeDetail' | 'outcomeTone'> =
    last === null
      ? { outcomeLabel: '', outcomeDetail: '', outcomeTone: 'none' }
      : { outcomeLabel: last.label, outcomeDetail: last.detail, outcomeTone: last.outcome === 'UNCONFIRMED' ? 'warning' : 'error' };
  if (holds.campaignReading) {
    return { ...none, ...outcome, state: 'busy', sending: holds.rowReading, ariaLabel };
  }
  if (holds.negativeWritePending || holds.targetingRemovalPending) {
    return { ...none, ...outcome, state: 'busy', ariaLabel, notSentMessage };
  }
  return { ...none, ...outcome, state: 'available', ariaLabel, notSentMessage };
}
