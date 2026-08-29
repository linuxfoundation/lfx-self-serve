// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACTIVITY_FEED_MAX_PAGE_SIZE,
  NEWSLETTER_BODY_MAX_LENGTH,
  NEWSLETTER_SUBJECT_MAX_LENGTH,
  VALKEY_CACHE,
  WEEKLY_BRIEF_ACTION_ITEMS_MAX,
  WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS,
  WEEKLY_BRIEF_DEFAULT_THROTTLE,
  WEEKLY_BRIEF_ERROR_REASON,
  WEEKLY_BRIEF_SHAREABLE_STATES,
} from '@lfx-one/shared/constants';
import {
  ActivityEvent,
  Committee,
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  GetWeeklyBriefActionItemsResponse,
  Newsletter,
  NewsletterSendResult,
  PaginatedResponse,
  QueryServiceResponse,
  RateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  ShareWeeklyBriefResult,
  ShareWeeklyBriefToSlackResult,
  WeeklyBrief,
  WeeklyBriefActionItem,
  WeeklyBriefCurrentActivity,
  WeeklyBriefCurrentResponse,
  WeeklyBriefRating,
  WeeklyBriefSourceRef,
} from '@lfx-one/shared/interfaces';
import { formatUtcDateRangeLabel, isGoverningBoard } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID } from '../constants';
import { AuthenticationError, AuthorizationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { getEffectiveSub, getEffectiveUsername, getRealEmail, resolveRealAccessToken } from '../utils/auth-helper';

import { AccessCheckService } from './access-check.service';
import { AiService } from './ai.service';
import { CommitteeActivityService } from './committee-activity.service';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NewsletterService } from './newsletter.service';
import { buildWeeklyBriefActionItemsCacheKey, buildWeeklyBriefRatingCacheKey, valkeyService } from './valkey.service';

/** Shape guard for a stored rating cache entry — shared by the read (`withCallerRating`) and write (`rateBrief`/`clearBriefRating`, for the `previous_rating` log field) paths so a corrupt/legacy entry degrades to a miss in both. */
function isStoredRating(value: unknown): value is RateWeeklyBriefResponse {
  return !!value && typeof value === 'object' && ((value as { rating?: unknown }).rating === 'up' || (value as { rating?: unknown }).rating === 'down');
}

/**
 * HTML-escapes a plain-text string, then converts blank-line-separated
 * paragraphs into `<p>` blocks (single newlines become `<br>`). The weekly
 * brief's `brief_text` is plain text today (rendered via a `<pre>` in the
 * card), so this is a minimal plain-text → HTML bridge for the newsletter
 * `body_html` field — not a markdown renderer.
 */
function briefTextToHtml(text: string): string {
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Returns the ISO timestamp for the upcoming Sunday at 00:00:00 UTC. Mirrors upstream's
 * `NextWindowReset()` — the advisory `window_resets_at` value surfaced in throttle bodies
 * and 429s. This is a display timestamp, not the actual counter-reset boundary: upstream
 * keys the throttle entry on the same `window_start` as the brief, so counters actually
 * reset at the Friday→Saturday 00:00 UTC window rollover (see `briefWindow()`).
 */
function nextSundayIso(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday, 0, 0, 0, 0));
  return next.toISOString();
}

/**
 * Returns the Sunday→Saturday ISO range upstream selects for the brief window:
 * the previous, completed week on Sunday–Friday, and the current (not-yet-
 * completed) week only on Saturday.
 */
export function briefWindow(): { window_start: string; window_end: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const thisWeekSunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 0, 0, 0, 0));
  const sunday =
    day === 6 ? thisWeekSunday : new Date(Date.UTC(thisWeekSunday.getUTCFullYear(), thisWeekSunday.getUTCMonth(), thisWeekSunday.getUTCDate() - 7, 0, 0, 0, 0));
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  saturday.setUTCHours(23, 59, 59, 999);
  return {
    window_start: sunday.toISOString(),
    window_end: saturday.toISOString(),
  };
}

/**
 * Returns [this week's Sunday 00:00 UTC, now] — the in-progress-week semantics "this week so
 * far" needs, as opposed to `briefWindow()`'s last-*completed*-week semantics (GH-1922). No
 * Saturday-rollover branch: unlike `briefWindow()`, this always looks at the current week,
 * every day of the week, including the still-open Sun–Fri span `briefWindow()` deliberately
 * skips past.
 */
export function currentWeekInProgressWindow(): { window_start: string; window_end: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 0, 0, 0, 0));
  return { window_start: sunday.toISOString(), window_end: now.toISOString() };
}

/**
 * Maps a `CommitteeActivityService` event to the weekly-brief tally's `WeeklyBriefSourceRef`
 * shape (GH-1922 rework — this tally is sourced from the same live meeting/vote/document
 * aggregation that already powers the committee "Recent Activity" feed, not a weekly-brief-
 * specific upstream call).
 *
 * `vote_opened` folds into kind `other`, not the `vote` kind `vote_closed` uses — the tally's
 * only vote phrase is literally "vote closed" (`WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES` has no
 * "vote opened" entry), and an in-progress, not-yet-closed vote isn't that yet. It still can't be
 * dropped outright (the `null` this file used to return here): the "Recent Activity" feed on the
 * same committee-overview page renders `vote_opened` directly for any voting-enabled committee, so
 * a week that opened but hasn't yet closed a vote must not report itself as "no activity yet" while
 * the feed right below it proves otherwise. `document_uploaded` and `notes_added` both collapse to
 * kind `doc` — both are "a document-like artifact was added this week," and the tally doesn't need
 * to distinguish committee-document files/folders/links from meeting-attachment notes — but their
 * ids DO carry the same namespace discriminants `committee-activity.service.ts`'s own `eventKey()`
 * uses (`document_type` / `meeting_scope`), not just a `document_uid`, since — per `ActivityEvent`'s
 * own doc comments — those are two distinct upstream uid namespaces that could otherwise collide
 * (e.g. a folder and a meeting-attachment note coincidentally sharing a uid), and a collision here
 * would produce two refs with the same `id` in the same rendered `doc` section (an Angular
 * duplicate-`@for`-track-key error, not a silent dedupe). `vote` does NOT carry this same
 * kind-prefix, deliberately — `weekly-brief.utils.ts`'s `resolveSourceRefAction` passes a `vote`
 * ref's raw `id` straight through as `voteUid`, already unique on its own upstream uid (one uid
 * namespace, unlike doc's two), and a `vote:` prefix would reach that click-through action as a
 * corrupted id instead of a real one.
 *
 * `meeting` is unprefixed for the same collision-avoidance reason, but its `id` is deliberately
 * `meeting_occurrence_id`, NOT the `meeting_id` `resolveSourceRefAction`'s `meetingId` actually
 * needs (see `MeetingHeldActivityEvent`'s own doc comment: a recurring meeting's occurrences
 * share one `meeting_id` but need distinct `@for` tracking keys, which is exactly what this
 * `id` doubles as via `weekly-brief-card.component.html`'s `track ref.id`). Known v1 residual:
 * wiring `current_activity.source_refs` into `mapWeeklyBriefSourceRefsToChips` (nothing does
 * today) would click through to the wrong meeting for a recurring series — closing this needs
 * `WeeklyBriefSourceRef` to carry the navigation id separately from the tracking id, not done
 * here since nothing consumes this mapper's meeting refs as click targets yet.
 *
 * `survey_published`/`survey_closed` (and `vote_opened`, above) map to kind `other` — not one of
 * `WEEKLY_BRIEF_SOURCE_SECTIONS`' five kinds, but real governance activity the client's existing
 * "other" catch-all already surfaces rather than silently dropping; `other` has no
 * `resolveSourceRefAction` case (falls to its `default: return null`), so it carries no id
 * contract to protect the way `vote`'s or `meeting`'s does — but unlike those two, `other` mixes
 * TWO upstream uid namespaces (`vote_uid` and `survey_uid`) in one rendered section, the same
 * shape `doc`'s `document_type`/`meeting_scope` prefixing above already exists to guard, so both
 * get the `vote:`/`survey:` prefix for the same reason, not left raw the way a single-namespace
 * kind can be.
 *
 * `member_joined`/`member_left`/other deferred types are the only ones that actually reach the
 * `default: return null` branch below in practice: `CommitteeActivityService` never constructs
 * those today (see `DeferredActivityEvent`'s own doc comment). It exists to stay exhaustive
 * against `ActivityEvent`'s full union, not because any currently-constructed event type needs it.
 */
function mapActivityEventToCurrentActivityRef(event: ActivityEvent): WeeklyBriefSourceRef | null {
  switch (event.type) {
    case 'meeting_held':
      return { id: event.payload.meeting_occurrence_id, kind: 'meeting', title: event.payload.title };
    case 'vote_closed':
      return { id: event.payload.vote_uid, kind: 'vote', title: event.payload.name };
    // Folds into `other`, not dropped: an open-but-not-yet-closed vote isn't "vote closed" (the
    // tally's only vote phrase), but dropping it produced a same-page contradiction — the
    // "Recent Activity" feed (mapActivityEventsToFeedItems, activity-feed.utils.ts) already
    // renders vote_opened for any committee with voting enabled, so a week whose only activity was
    // opening a vote would have shown "no activity yet" directly beneath a feed proving otherwise.
    // Prefixed, unlike `vote_closed` above: `other` now holds two upstream uid namespaces
    // (vote_uid here, survey_uid below), the same two-namespace situation `doc`'s prefixing
    // already exists to guard against, not the single-namespace case the unprefixed `vote` kind's
    // own doc comment describes.
    case 'vote_opened':
      return { id: `vote:${event.payload.vote_uid}`, kind: 'other', title: event.payload.name };
    case 'document_uploaded':
      return { id: `document:${event.payload.document_type}:${event.payload.document_uid}`, kind: 'doc', title: event.payload.name };
    case 'notes_added':
      return { id: `note:${event.payload.meeting_scope}:${event.payload.document_uid}`, kind: 'doc', title: event.payload.name };
    case 'survey_published':
    case 'survey_closed':
      return { id: `survey:${event.payload.survey_uid}`, kind: 'other', title: event.payload.title };
    default:
      return null;
  }
}

/**
 * Mock-only, in-memory brief store keyed by committee. Mock mode is otherwise stateless (no
 * persistence, resets on server restart — see `WeeklyBriefService`'s class doc), but two real
 * gaps came from treating it as fully stateless:
 *
 * 1. The client's poll-until-terminal guard (`pollUntilTerminal`'s `priorRevision` check,
 *    LFXV2-2176 round 2) rejects a terminal tick whose revision still matches the pre-regenerate
 *    brief. Without persisting the bump `generateBrief` promises in its own 202 response, every
 *    subsequent `getCurrentBrief` GET reported the same hardcoded revision — a mock regenerate
 *    could never satisfy that guard and hung until the poll's attempt cap (Cursor Bugbot).
 * 2. Persisting *only* the revision (round 3) still discarded everything else a save or
 *    regenerate produced — `brief_text`, `state`, `regeneration_count` all reverted to
 *    `buildMockBrief`'s canned defaults on the very next GET, so a successful save appeared to
 *    silently revert in local/mock dev, and a regenerate's `regeneration_count` reset to 0 on
 *    the next poll tick (Copilot review). Storing the full `WeeklyBrief` closes both at once.
 */
const mockBriefByCommittee = new Map<string, WeeklyBrief>();

function currentMockBrief(committeeId: string): WeeklyBrief {
  const tracked = mockBriefByCommittee.get(committeeId);
  if (tracked) return tracked;
  // Deterministic quiet-week fixture for WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID — see its
  // own docstring for why this is exercised only by weekly-brief.service.spec.ts, not reachable
  // through the running app (LFXV2-3000).
  if (committeeId === WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID) {
    return buildMockBrief(committeeId, { state: 'error', error_reason: WEEKLY_BRIEF_ERROR_REASON.NO_SOURCES });
  }
  return buildMockBrief(committeeId);
}

function storeMockBrief(committeeId: string, brief: WeeklyBrief): WeeklyBrief {
  mockBriefByCommittee.set(committeeId, brief);
  return brief;
}

/**
 * Test-only: clear the mock brief store so tests reusing the same committeeId across `it()`
 * blocks (this module's own spec included) don't leak state from one test into the next.
 * Not exported from the package's public surface.
 */
export function __resetMockBriefStateForTesting(): void {
  mockBriefByCommittee.clear();
}

/**
 * Builds a mock WeeklyBrief shifted by `windowOffsetWeeks` relative to the current window.
 * Pass 0 for the current week, -1 for last week, -2 for two weeks ago, etc.
 * Used by both `buildMockBrief` (current-week mock) and `listBriefs` (archive mocks).
 */
function buildMockWeeklyBrief(committeeId: string, windowOffsetWeeks: number, overrides: Partial<WeeklyBrief> = {}): WeeklyBrief {
  const nowIso = new Date().toISOString();
  const base = briefWindow();
  const offsetMs = windowOffsetWeeks * 7 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(new Date(base.window_start).getTime() + offsetMs).toISOString();
  const windowEnd = new Date(new Date(base.window_end).getTime() + offsetMs).toISOString();
  const indexSuffix = String(Math.abs(windowOffsetWeeks)).padStart(2, '0');
  return {
    uid: `wb_mock_00000000-0000-0000-0000-0000000000${indexSuffix}`,
    committee_uid: committeeId,
    window_start: windowStart,
    window_end: windowEnd,
    state: 'generated',
    brief_text:
      'This week the working group made steady progress across collaboration and delivery streams. ' +
      'There were 2 meetings held, with active participation from 3 members covering roadmap alignment, ' +
      'open issues, and upcoming release planning.\n\n' +
      'Discussion focused on outstanding action items, contributor onboarding, and prioritization for the ' +
      'next iteration. The group surfaced no blocking risks and is on track for the planned milestones.',
    // Representative refs across the kinds lfx-v2-committee-service's brief generator
    // actually emits (LFXV2-3044) — mock mode otherwise never exercises the Sources chip
    // row. Ids are synthetic; a chip's click-through target (e.g. a meeting join page) isn't
    // guaranteed to resolve against this app's mocked/live backends in mock mode.
    source_refs: [
      { id: 'mock-meeting-1', kind: 'meeting', title: 'Weekly Sync' },
      { id: 'mock-mailing-list-1', kind: 'mailing-list', title: 'Roadmap discussion thread' },
      { id: 'mock-vote-1', kind: 'vote', title: 'Q1 Budget' },
      { id: 'weekly-members', kind: 'members', title: 'Member roster changes' },
    ],
    prompt_version: 'v1',
    model: 'mock',
    regeneration_count: 0,
    // Upstream's derivePrivateSourcePresent (group_weekly_brief_generator.go) always sets this
    // true when the brief has any member activity — "members are inherently private" — and a
    // "members" source_ref only exists when memberCount > 0, so a members ref + false here is a
    // combination upstream can never actually produce (Copilot review, PR #1363).
    private_source_present: true,
    created_at: nowIso,
    updated_at: nowIso,
    revision: 1,
    ...overrides,
  };
}

function buildMockBrief(committeeId: string, overrides: Partial<WeeklyBrief> = {}): WeeklyBrief {
  return buildMockWeeklyBrief(committeeId, 0, overrides);
}

/**
 * Service for the WG Weekly Brief feature.
 *
 * `getCurrentBrief` / `generateBrief` / `saveBrief` switch between mock data
 * (default) and live committee-service proxy based on `WEEKLY_BRIEF_BACKEND`.
 * Mock mode lets the UI iterate without standing up the upstream brief
 * endpoints; flipping to 'live' proxies straight through. Mock mode is
 * refused outright when `NODE_ENV=production` — see `isLive()`. `shareBrief`
 * always enforces its precondition checks (brief exists, caller is a writer,
 * committee has a mailing list) regardless of mode, but the send itself
 * requires `WEEKLY_BRIEF_BACKEND=live` — it never fires against mock brief
 * content.
 */
export class WeeklyBriefService {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();
  private committeeService: CommitteeService = new CommitteeService();
  private committeeActivityService: CommitteeActivityService = new CommitteeActivityService();
  private newsletterService: NewsletterService = new NewsletterService();
  private accessCheckService: AccessCheckService = new AccessCheckService();
  private aiService: AiService = new AiService();

  /**
   * GET /committees/:committeeId/weekly-briefs/current — see `fetchBriefResponse` for the
   * mock/live `brief`/`throttle` contract this builds on.
   *
   * `includeCurrentActivity` (default true) lets a caller opt out of the current_activity
   * (GH-1922) fan-out entirely — worth having because `getCommitteeActivity`'s own multi-call
   * aggregation isn't free, and this week's activity can't change within one poll cycle, so
   * re-running it on every tick would multiply a real upstream cost for a value that's already
   * correct from the first tick. Two independent client callers opt out, each on its own signal
   * — see `WeeklyBriefService#getWeeklyBrief` (the Angular client, `app/shared/services/`) for
   * which callers, when, and why — and see `WeeklyBriefCurrentResponse.current_activity`'s doc
   * comment (`@lfx-one/shared/interfaces`) for the absent/null/present contract this option
   * interacts with. Not re-derived here to avoid yet another copy of that contract drifting out
   * of sync with the other five that already reference it.
   */
  public async getCurrentBrief(req: Request, committeeId: string, options: { includeCurrentActivity?: boolean } = {}): Promise<WeeklyBriefCurrentResponse> {
    const includeCurrentActivity = options.includeCurrentActivity ?? true;
    // current_activity (GH-1922) is sourced from CommitteeActivityService's existing live
    // aggregation — runs identically in mock and live mode, since that service has no mock/live
    // split of its own; only fetchBriefResponse's own mock-vs-proxy branch (brief/throttle)
    // differs between the two. Run in parallel with fetchBriefResponse, not after — the two are
    // independent reads, so awaiting them sequentially would make this tally's latency fully
    // additive on top of the brief fetch for no reason.
    //
    // Only built here, not inside fetchBriefResponse — every internal caller that reuses that
    // helper (getActionItems, shareBrief, shareToSlack, resolveRatableBrief) only ever reads
    // brief/caller_rating off the result, so building the tally for them too would pay a real
    // upstream fan-out (getCommitteeBase, and for a governance committee,
    // CommitteeActivityService's own multi-call aggregation) for a field they'd discard on every
    // write path (share, rate) and every read of just the AI-extracted action items.
    const [response, currentActivity] = await Promise.all([
      this.fetchBriefResponse(req, committeeId),
      includeCurrentActivity ? this.buildCurrentActivityWithBudget(req, committeeId) : Promise.resolve(undefined),
    ]);
    // !== undefined, not truthiness — currentActivity can be null (a settled "doesn't apply"
    // answer, see buildCurrentActivity's doc comment), which is a real value the client needs
    // to see, not an absence to fall through on.
    return currentActivity !== undefined ? { ...response, current_activity: currentActivity } : response;
  }

  /**
   * GET /committees/:committeeId/weekly-briefs (paginated archive list)
   *
   * Live mode: queries the query-service `group_weekly_brief` index filtered by
   * `committee_uid` tag. Access is gated at the controller layer via `assertCommitteeRead`
   * before this method is called — do not invoke without a prior access check.
   *
   * Mock mode: returns three canned past briefs (previous three weeks) so the archive
   * drawer is fully exercisable locally without standing up the upstream index.
   */
  public async listBriefs(req: Request, committeeId: string, query: { limit?: string; page_token?: string } = {}): Promise<PaginatedResponse<WeeklyBrief>> {
    if (!this.isLive(req)) {
      logger.debug(req, 'list_weekly_briefs', 'Returning mock brief archive', { committee_id: committeeId });
      const isSecondPage = !!query['page_token'];
      return {
        data: isSecondPage
          ? [buildMockWeeklyBrief(committeeId, -4), buildMockWeeklyBrief(committeeId, -5), buildMockWeeklyBrief(committeeId, -6)]
          : [buildMockWeeklyBrief(committeeId, -1), buildMockWeeklyBrief(committeeId, -2), buildMockWeeklyBrief(committeeId, -3)],
        page_token: isSecondPage ? undefined : 'mock-cursor-page-2',
      };
    }

    logger.debug(req, 'list_weekly_briefs', 'Querying group_weekly_brief index', { committee_id: committeeId });

    const rawLimit = parseInt(query['limit'] ?? '', 10);
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

    const params: Record<string, string | undefined> = {
      type: 'group_weekly_brief',
      tags: `committee_uid:${committeeId}`,
      page_size: String(limit),
      ...(query['page_token'] && { page_token: query['page_token'] }),
    };

    const { resources, page_token } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<WeeklyBrief>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    // Exclude the current week's brief (window hasn't closed yet) — the card already shows it.
    const now = new Date();
    return { data: resources.map((r) => r.data).filter((b) => new Date(b.window_end) < now), page_token };
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * BFF-only feature (LFXV2-3042) — no upstream endpoint. `revision` is the revision the caller
   * actually rendered when they tapped — `resolveRatableBrief` rejects with a 409
   * (`REVISION_MISMATCH`) when it no longer matches the server-resolved current revision, so a
   * stale tab can never misattribute a vote to content the rater didn't actually see (PR #1361
   * review; see `resolveRatableBrief`'s doc comment for the full reasoning). Upserts (re-rating,
   * including switching up↔down, overwrites the same Valkey key — no duplicate row); a later
   * regenerate produces a new `revision` and therefore a new key, so the new revision starts
   * unrated (never carries the old rating forward).
   *
   * Blocked entirely during impersonation (`blockDuringImpersonation` in `weekly-brief.route.ts`):
   * `requireUsername`/`getEffectiveUsername` resolves the *impersonated* user's identity, and
   * unlike generate/save/share (which proxy the caller's bearer token through untouched, so the
   * upstream write is attributed to whoever actually authenticated) this write lands directly in
   * the target user's own Valkey key — the same wrong-account-write class the profile/enrollment
   * routes already guard against.
   *
   * Valkey is a fail-soft, TTL cache, not a system of record — a lost write here only degrades
   * the "you already rated this" UI indicator on a future load. Logged as a warning, but only
   * when the cache is actually enabled (`VALKEY_URL` set): an unset `VALKEY_URL` is a documented
   * supported deployment mode (direct-fetch fallback), not a fault, and warning on every rating
   * in that mode would bury the genuine-fault signal this exists to surface. The durable
   * analytics signal is the `rating_recorded` log line below (carrying `user_id` — the opaque
   * OIDC `sub`, not the human-readable LFID username, since this line is retained indefinitely —
   * and the prior value, so re-rates/switches can be deduplicated per caller during offline
   * analysis instead of each toggle over-counting as a distinct vote), which flows through the
   * existing Pino → CloudWatch pipeline.
   */
  public async rateBrief(req: Request, committeeId: string, briefUid: string, rating: WeeklyBriefRating, revision: number): Promise<RateWeeklyBriefResponse> {
    const { brief, callerRating: previousRating } = await this.resolveRatableBrief(req, committeeId, briefUid, revision, 'rate_weekly_brief');
    const username = this.requireUsername(req, 'rate_weekly_brief');
    const key = this.requireRatingKey(committeeId, brief.uid, brief.revision, username, 'rate_weekly_brief');

    const persisted = await valkeyService.setJson(key, { rating }, VALKEY_CACHE.WEEKLY_BRIEF_RATING_TTL_SECONDS);
    if (!persisted && valkeyService.isEnabled()) {
      logger.warning(req, 'rating_persist_failed', 'Weekly brief rating was accepted but not persisted to Valkey — will not survive a reload', {
        committee_id: committeeId,
        brief_uid: brief.uid,
        revision: brief.revision,
      });
    }
    logger.info(req, 'rating_recorded', 'Weekly brief rating recorded', {
      committee_id: committeeId,
      brief_uid: brief.uid,
      revision: brief.revision,
      prompt_version: brief.prompt_version,
      model: brief.model,
      // Opaque OIDC sub, not the LFID username — `username` (used above for the Valkey key,
      // where per-user cache keys already convention on it — see buildUserCacheKey) is
      // human-readable PII and this log line is retained indefinitely as the durable analytics
      // record, unlike a short-TTL cache entry. `sub` still uniquely and stably identifies the
      // caller for dedup purposes without persisting a readable identifier into the log stream
      // (PR #1361 review — docs/reviews/knowledge-base/security.md's
      // `security/pii-in-logs-and-identifiers`).
      user_id: getEffectiveSub(req),
      previous_rating: previousRating,
      // `previous_rating: null` is ambiguous on its own — genuinely never rated, or unknowable
      // (evicted, or a transient read fault). `ValkeyService.getJson` swallows every fault
      // internally and returns null either way, so this can only honestly report the
      // *deployment-mode* half of that ambiguity (Valkey disabled entirely) — it does NOT catch
      // a transient fault against an enabled cache, which still surfaces as `previous_rating:
      // null, rating_cache_enabled: true`. Named for exactly what it measures rather than
      // over-claiming precision the underlying read doesn't expose; offline analysis should
      // still treat `previous_rating: null` as low-confidence regardless of this flag, and use
      // it only to identify the definitely-unknowable (disabled-cache) subset.
      rating_cache_enabled: valkeyService.isEnabled(),
      rating,
    });

    return { rating };
  }

  /**
   * DELETE /committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * Clears the caller's rating on the current brief revision. `revision` is required and enforced
   * the same way `rateBrief` enforces it (409 `REVISION_MISMATCH` on drift) — without it, a stale
   * tab's "clear" tap would delete whatever revision is *currently* current instead of the one the
   * user actually saw as rated, silently no-op-ing against the wrong key while the real rating on
   * the old revision sits untouched (PR #1361 review). Same impersonation block and
   * fail-soft/durable-log split as `rateBrief` — see its doc comment.
   */
  public async clearBriefRating(req: Request, committeeId: string, briefUid: string, revision: number): Promise<void> {
    const { brief, callerRating: previousRating } = await this.resolveRatableBrief(req, committeeId, briefUid, revision, 'clear_weekly_brief_rating');
    const username = this.requireUsername(req, 'clear_weekly_brief_rating');
    const key = this.requireRatingKey(committeeId, brief.uid, brief.revision, username, 'clear_weekly_brief_rating');

    const persisted = await valkeyService.del(key);
    if (!persisted && valkeyService.isEnabled()) {
      logger.warning(req, 'rating_persist_failed', 'Weekly brief rating clear was accepted but not persisted to Valkey', {
        committee_id: committeeId,
        brief_uid: brief.uid,
        revision: brief.revision,
      });
    }
    logger.info(req, 'rating_cleared', 'Weekly brief rating cleared', {
      committee_id: committeeId,
      brief_uid: brief.uid,
      revision: brief.revision,
      prompt_version: brief.prompt_version,
      model: brief.model,
      user_id: getEffectiveSub(req),
      previous_rating: previousRating,
      rating_cache_enabled: valkeyService.isEnabled(),
    });
  }

  /**
   * GET /committees/:committeeId/weekly-briefs/action-items (LFXV2-3043)
   *
   * AI-extracted follow-up items from the current brief's `brief_text`, surfaced in the
   * committee Overview page's "My Pending Actions" widget. Extraction runs lfx-one-side,
   * once per `(committeeId, brief.uid, brief.revision)` triple, cached in Valkey — a cache
   * hit skips the AI call entirely. A brief that hasn't reached a terminal readable state
   * (`WEEKLY_BRIEF_SHAREABLE_STATES`) yet, or has no text yet, degrades to an empty list
   * without calling the AI service at all. Extraction itself failing (AI misconfigured,
   * proxy error, malformed response) also degrades to an empty list for THIS response — but
   * is deliberately never cached (see the catch block below), so a transient failure doesn't
   * pin the brief revision to zero items for the full TTL. Per the ticket, a legitimate empty
   * extraction (a genuinely quiet week) IS cached, so a quiet week doesn't re-hit the AI proxy
   * on every page view.
   *
   * The Valkey cache is the only thing bounding AI spend on this GET (unlike the agenda/
   * newsletter paths, which are user-initiated POSTs) — when Valkey isn't CONFIGURED
   * (`isEnabled()` — no `VALKEY_URL`), this skips extraction entirely rather than firing an
   * uncached AI call on every single read (full-branch review finding). `isEnabled()` reflects
   * configuration, not live connection health, though: a configured-but-currently-unreachable
   * Valkey still passes this guard and falls through to `getJson`'s normal fail-soft timeout
   * (a miss, same as an actual cache miss) — that narrower case isn't covered here.
   */
  public async getActionItems(req: Request, committeeId: string): Promise<GetWeeklyBriefActionItemsResponse> {
    const { brief } = await this.fetchBriefResponse(req, committeeId);
    if (!brief || !WEEKLY_BRIEF_SHAREABLE_STATES.includes(brief.state) || !brief.brief_text?.trim()) {
      return { items: [] };
    }

    if (!valkeyService.isEnabled()) {
      // DEBUG, not WARN — an unconfigured Valkey is an expected steady-state condition in some
      // environments (e.g. local dev), not a per-request anomaly; this fires on every
      // committee-overview page view in that environment and would otherwise drown real signal.
      logger.debug(req, 'get_weekly_brief_action_items', 'Cache not configured, skipping extraction', {
        committee_id: committeeId,
        brief_uid: brief.uid,
      });
      return { items: [] };
    }

    const cacheKey = buildWeeklyBriefActionItemsCacheKey(committeeId, brief.uid, brief.revision);
    if (!cacheKey) {
      // committeeId or brief.uid failed isFilterSafeIdentifier — should never happen for real
      // upstream identifiers, so this is worth a warning: it means this committee's brief will
      // return zero action items on every read (fails closed by skipping extraction entirely
      // rather than hitting the AI proxy uncached on every single read).
      logger.warning(req, 'get_weekly_brief_action_items', 'Brief uid is not cache-key safe, skipping extraction', {
        committee_id: committeeId,
        brief_uid: brief.uid,
      });
      return { items: [] };
    }

    const cached = await valkeyService.getJson<WeeklyBriefActionItem[]>(cacheKey, (value) => Array.isArray(value));
    if (cached) {
      return { items: cached };
    }

    let items: WeeklyBriefActionItem[];
    try {
      const extraction = await this.aiService.extractBriefActionItems(req, { brief_text: brief.brief_text });
      items = extraction.items.slice(0, WEEKLY_BRIEF_ACTION_ITEMS_MAX).map((item, index) => ({
        // committeeId, not just brief.uid/revision — the cache key gained this scoping earlier,
        // but this per-item uid (which HiddenActionsService hashes into the dismiss-cookie
        // identity) didn't. Without it, the mock-mode brief fixture's shared uid across
        // committees means dismissing item 0 in one committee hides item 0 in every committee
        // (PR #1362 review — Copilot).
        uid: `${committeeId}-${brief.uid}-${brief.revision}-${index}`,
        text: item.text,
        suggested_owner_role: item.suggested_owner_role,
        source_brief_uid: brief.uid,
        committee_uid: committeeId,
      }));
    } catch (error) {
      // Graceful degradation, not a system failure — WARN, not logger.error (logging-patterns.md).
      // The brief page must render normally with zero brief-sourced actions and no error toast.
      // Returns directly instead of falling through to the setJson below — caching this failure
      // as if it were a legitimate empty extraction would pin the brief revision to zero items
      // for the full TTL, with no invalidation path short of the brief itself regenerating.
      logger.warning(req, 'get_weekly_brief_action_items', 'Action-item extraction failed, degrading to empty list', {
        committee_id: committeeId,
        brief_uid: brief.uid,
        err: error,
      });
      return { items: [] };
    }

    const writeSucceeded = await valkeyService.setJson(cacheKey, items, VALKEY_CACHE.WEEKLY_BRIEF_ACTION_ITEMS_TTL_SECONDS);
    if (!writeSucceeded) {
      // isEnabled() (checked above) only reflects configuration, not live connection health — a
      // configured-but-currently-unreachable Valkey passes that guard and reaches this point.
      // setJson also fails soft on other faults (oversized value, op timeout), so "unreachable"
      // isn't the only cause — but every cause here means this extraction ran uncached and the
      // next read will re-extract too, so it's worth a warning regardless of which fault it was.
      // The response to the caller is unaffected (the freshly-extracted items are still returned
      // below) — this only affects whether the NEXT read hits the AI proxy again.
      logger.warning(
        req,
        'get_weekly_brief_action_items',
        'Extraction result could not be cached — every read of this brief revision will re-invoke the AI proxy until caching recovers',
        {
          committee_id: committeeId,
          brief_uid: brief.uid,
        }
      );
    }

    return { items };
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/generate
   *
   * Asynchronous upstream: 202 with the brief in `generating` state; the
   * source-gather + LLM call run out-of-band, and callers observe the
   * terminal `generated`/`error` state via GET /current. We propagate the
   * real status code (via `proxyRequestWithResponse`) instead of collapsing
   * everything to 200, so the client can tell "accepted, still working" from
   * "done". 409 (`edited_brief_exists`) and 429 (`throttle_exceeded`) are
   * propagated as-is.
   */
  public async generateBrief(
    req: Request,
    committeeId: string,
    body: GenerateWeeklyBriefRequest
  ): Promise<{ status: number; data: GenerateWeeklyBriefResponse }> {
    if (!this.isLive(req)) {
      const tracked = currentMockBrief(committeeId);
      // A regeneration_count of 0 means "the fresh (non-forced) generate for this window" —
      // upstream only increments it on subsequent force:true calls. Cumulative across
      // successive regenerates (not reset to a flat 1 each time), matching how revision
      // already accumulates below.
      const regenerationCount = body?.force ? tracked.regeneration_count + 1 : 0;
      // Only a regenerate (force:true) needs a genuinely new revision — that's the only path
      // the client's priorRevision poll guard applies to. A fresh generate keeps the current
      // revision unchanged.
      const revision = body?.force ? tracked.revision + 1 : tracked.revision;
      // Mock mode completes synchronously (no background job to model the real async delay
      // against) — the STORED brief is already 'generated' so a single follow-up GET
      // /current naturally "completes" the poll, same as before this store existed. The 202
      // response body below still reports 'generating' to mimic the real envelope shape.
      const completed = storeMockBrief(committeeId, {
        ...tracked,
        state: 'generated',
        regeneration_count: regenerationCount,
        revision,
        updated_at: new Date().toISOString(),
      });
      const data: GenerateWeeklyBriefResponse = {
        brief: { ...completed, state: 'generating' },
        throttle: {
          ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
          generates_used: 1,
          regenerations_used: regenerationCount,
          window_resets_at: nextSundayIso(),
        },
      };
      return { status: 202, data };
    }

    logger.debug(req, 'generate_weekly_brief', 'Proxying to committee-service', { committee_id: committeeId, force: body?.force });
    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<GenerateWeeklyBriefResponse>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/generate`,
        'POST',
        undefined,
        body
      );
      return { status: response.status, data: response.data };
    } catch (error) {
      throw this.withConflictBody(error);
    }
  }

  /**
   * PUT /committees/:committeeId/weekly-briefs/current
   *
   * 409 (revision conflict) is propagated as-is so the UI can prompt the user to
   * reload the latest server copy before retrying their edit.
   */
  public async saveBrief(req: Request, committeeId: string, body: SaveWeeklyBriefRequest): Promise<WeeklyBrief> {
    if (!this.isLive(req)) {
      const tracked = currentMockBrief(committeeId);
      // Mirror the live backend's optimistic-concurrency contract: reject a stale revision
      // (409) instead of silently accepting the write, which could move the tracked revision
      // backward or out of sync with a newer save/regenerate that already landed (CodeRabbit
      // review — mock mode must enforce the same conflict contract the live path does).
      if (body.revision !== tracked.revision) {
        throw new MicroserviceError('Someone else updated this brief. Reload to see the latest version before retrying.', 409, 'REVISION_CONFLICT', {
          operation: 'save_weekly_brief',
          service: 'weekly_brief_service',
          errorBody: { details: { code: 'revision_conflict', revision: tracked.revision } },
        });
      }
      return storeMockBrief(committeeId, {
        ...tracked,
        state: 'edited',
        brief_text: body.brief_text,
        revision: tracked.revision + 1,
        updated_at: new Date().toISOString(),
      });
    }

    logger.debug(req, 'save_weekly_brief', 'Proxying to committee-service', { committee_id: committeeId });
    try {
      return await this.microserviceProxy.proxyRequest<WeeklyBrief>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`,
        'PUT',
        undefined,
        body
      );
    } catch (error) {
      throw this.withConflictBody(error);
    }
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/share
   *
   * Sends the current saved brief to the committee's mailing list. There is no
   * mailing-list send endpoint anywhere (this repo's mailing-list controller/
   * service, nor the upstream lfx-v2-mailing-list-service) — this repurposes the
   * newsletter send pipeline instead (create + send), whose recipients resolve
   * from `committee_uids` rather than the Groups.io mailing list itself. See
   * the LFXV2-2914 plan for the full rationale and trade-offs.
   *
   * The newsletter send is asynchronous (202 Accepted; fan-out completes in a
   * detached background job upstream) — `total_recipients` is a snapshot taken
   * at acceptance, not a delivered/failed count.
   *
   * Authorization is `project:{project_uid}#writer`, not `committee.writer` —
   * the newsletter service only recognizes the former, and there's no delegated/
   * on-behalf-of token mechanism in this codebase to bridge a direct-committee-
   * grant-only writer through to it (see the isProjectWriter check below). This
   * narrows who can share versus the ticket's original "chair/admin" framing;
   * a committee chair who isn't also a project writer will get a 403.
   *
   * Requires `WEEKLY_BRIEF_BACKEND=live` — throws a 409 `BACKEND_NOT_LIVE`
   * otherwise, after still enforcing the brief/writer/mailing-list
   * preconditions below (so mock-mode testing exercises the same guards).
   *
   * Unlike `/share-slack` and `/rating`, this is NOT blocked during impersonation
   * (LFXV2-3093) — it stays usable so LF staff can trigger a share while
   * impersonating a chair for support purposes. Instead, the write boundary (from
   * the project-writer check through the newsletter create/send/cleanup below)
   * runs under the REAL impersonating staff member's identity/token, resolved via
   * `resolveRealAccessToken`/`getRealEmail`, not the impersonated target's — so
   * authorization and attribution stay consistent (whoever is authorized to send
   * is also who the send is attributed to) and the outgoing email is never sent
   * under, or misattributed to, a user who never took the action. Preconditions
   * above this point (brief existence/state, committee lookup, mailing-list
   * check) stay on the effective/target identity, same as every other read in
   * this service — impersonation still shows staff what the target sees.
   */
  public async shareBrief(req: Request, committeeId: string, expectedRevision: number): Promise<ShareWeeklyBriefResult> {
    const { brief } = await this.fetchBriefResponse(req, committeeId);
    if (!brief || !WEEKLY_BRIEF_SHAREABLE_STATES.includes(brief.state)) {
      throw new ResourceNotFoundError('Weekly brief', committeeId, {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }
    // The confirmation dialog shows whatever revision was rendered client-side at the
    // time of confirmation — if another writer saved an edit since then, that's no
    // longer the text the caller actually reviewed and approved sending. Same revision-
    // conflict convention as saveBrief/generateBrief, applied here so a stale approval
    // can't silently email newer, unreviewed content.
    if (brief.revision !== expectedRevision) {
      throw new ConflictError('The brief has been updated since you last viewed it. Reload to review the latest version before sharing.', 'REVISION_MISMATCH', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }

    const committee = await this.committeeService.getCommitteeById(req, committeeId);

    // Everything from here through the newsletter create/send/cleanup below is the write
    // boundary (LFXV2-3093) — resolved and authorized against the REAL impersonating staff
    // member's identity, not the impersonated target's. Resolved once, up front: if the real
    // token can't be resolved (no session token, or an expired one that fails to refresh),
    // fail closed here rather than let the writer check pass against the target and only then
    // fail deeper into the newsletter pipeline. A no-op when not impersonating (returns
    // req.bearerToken as-is).
    const realToken = await resolveRealAccessToken(req);
    if (!realToken) {
      throw new AuthenticationError('Unable to resolve your account for this action', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }

    // committee.writer is a superset of what we need here — per committee.interface.ts's
    // own doc comment, it's true for both a direct committee-level grant AND an inherited
    // project writer, but the newsletter service (which this repurposes for delivery)
    // only recognizes project:{project_uid}#writer. A direct-grant-only committee writer
    // would pass committee.writer, then 403 from the newsletter service — and there's no
    // delegated/on-behalf-of token mechanism in this codebase to bridge that gap without
    // misattributing the send (the newsletter service resolves the sender's display name
    // from the signed JWT principal; an M2M token has none). Check the actual boundary
    // directly instead, with the REAL caller's own bearer token (LFXV2-3093) — not the
    // impersonated target's, so authorization and attribution stay consistent.
    //
    // checkSingleAccessStrict, not checkSingleAccess — the non-strict variant degrades a
    // transient access-check outage to "no access", which would surface here as a
    // misleading 403 NOT_PROJECT_WRITER instead of a retryable error. Sharing is a
    // deliberate, low-frequency action (unlike a list-view access annotation, where
    // fail-closed-to-false is an acceptable trade-off), so misattributing an outage as a
    // permission denial is worse here — same rationale as committee-access.internal.helper.ts's
    // existing use of the strict variant.
    const originalTokenForAuthCheck = req.bearerToken;
    req.bearerToken = realToken;
    let isProjectWriter: boolean;
    try {
      isProjectWriter = await this.accessCheckService.checkSingleAccessStrict(req, {
        resource: 'project',
        id: committee.project_uid,
        access: 'writer',
      });
    } finally {
      req.bearerToken = originalTokenForAuthCheck;
    }
    if (!isProjectWriter) {
      throw new AuthorizationError('Only project writers can share the weekly brief by email', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
        code: 'NOT_PROJECT_WRITER',
      });
    }
    // hasMailingListStrict, not the fail-open-to-false `has_mailing_list` field
    // getCommitteeById's includeMailingListStatus would otherwise compute — a transient
    // query-service failure here must not be misreported as "no mailing list configured"
    // (409 NO_MAILING_LIST is a real, actionable precondition failure; an outage isn't).
    // Read on the effective/target identity (req.bearerToken was restored above) — only the
    // write below runs under the real identity.
    const hasMailingList = await this.committeeService.hasMailingListStrict(req, committeeId);
    if (!hasMailingList) {
      throw new ConflictError('Committee has no mailing list configured', 'NO_MAILING_LIST', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }

    // Preconditions above (brief exists, caller is a writer, committee has a
    // mailing list) are enforced regardless of backend mode. Only the actual
    // send is gated on isLive() — the read side is mock-backed by default
    // (WEEKLY_BRIEF_BACKEND unset/!='live') and returns canned placeholder
    // text, so a real send from mock content must never happen. Fails loudly
    // rather than fabricating a success the caller can't distinguish from a
    // real send.
    if (!this.isLive(req)) {
      throw new ConflictError('Sharing is not available in this environment (WEEKLY_BRIEF_BACKEND is not "live")', 'BACKEND_NOT_LIVE', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }

    const subject = `[Weekly Brief] ${committee.name} — ${formatUtcDateRangeLabel(brief.window_start, brief.window_end)}`;
    const bodyHtml = briefTextToHtml(brief.brief_text);
    // getRealEmail, not getEffectiveEmail (LFXV2-3093) — the reply-to must be the real
    // sender's address, never the impersonated target's, matching the real identity the
    // newsletter is created and sent under below.
    const edReplyEmail = getRealEmail(req);
    if (!edReplyEmail) {
      throw ServiceValidationError.forField('ed_reply_email', 'Unable to resolve your account email for the reply-to address', {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }
    if (subject.length > NEWSLETTER_SUBJECT_MAX_LENGTH) {
      throw ServiceValidationError.forField('subject', `Subject must be ${NEWSLETTER_SUBJECT_MAX_LENGTH} characters or fewer`, {
        operation: 'share_weekly_brief',
        service: 'weekly_brief_service',
      });
    }
    if (bodyHtml.length > NEWSLETTER_BODY_MAX_LENGTH) {
      throw ServiceValidationError.forField(
        'brief_text',
        `Brief is too long to share (must render to ${NEWSLETTER_BODY_MAX_LENGTH} characters or fewer as HTML)`,
        {
          operation: 'share_weekly_brief',
          service: 'weekly_brief_service',
        }
      );
    }

    // The newsletter draft is created and sent under the REAL caller's own bearer token
    // (LFXV2-3093), restored to the impersonated/effective token in the finally below
    // regardless of outcome — the same save/mutate/restore shape this codebase already uses
    // for M2M tokens (e.g. meeting.controller.ts's getMyMeetingRegistrants), but with
    // try/finally rather than that precedent's linear post-call restore, so the token is
    // restored even if one of the awaited calls below throws, not just on the happy path.
    // isProjectWriter (checked above, also against the real identity) is the newsletter
    // service's actual authorization boundary; the sender's display name resolves from
    // this token's JWT principal too (see NewsletterServiceClient#sendNewsletter's doc
    // comment), so both the authorization and the visible "from" identity are the real
    // staff member's, not the impersonated target's.
    const originalTokenForSend = req.bearerToken;
    req.bearerToken = realToken;
    try {
      const newsletter: Newsletter = await this.newsletterService.createNewsletter(req, committee.project_uid, {
        subject,
        body_html: bodyHtml,
        ed_reply_email: edReplyEmail,
        committee_uids: [committeeId],
      });

      let sendResult: NewsletterSendResult;
      try {
        sendResult = await this.newsletterService.sendNewsletter(req, committee.project_uid, newsletter.id, newsletter.version);
      } catch (error) {
        // Only clean up on a deterministic rejection (draft validation failed,
        // not found, etc). The send is asynchronous — a timeout or 5xx *after*
        // upstream accepted it is indistinguishable from a real rejection here,
        // and deleting the draft in that case would desync us from a send that
        // actually went out. Ambiguous failures are left in place and logged.
        const isDeterministicRejection =
          error instanceof MicroserviceError && error.statusCode >= 400 && error.statusCode < 500 && ![408, 409, 429].includes(error.statusCode);
        if (isDeterministicRejection) {
          try {
            await this.newsletterService.deleteNewsletter(req, committee.project_uid, newsletter.id);
          } catch (cleanupError) {
            logger.warning(req, 'share_weekly_brief_cleanup_failed', 'Failed to delete orphaned draft newsletter after a failed send', {
              committee_id: committeeId,
              newsletter_id: newsletter.id,
              error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
            });
          }
        } else {
          // The original error is rethrown below and logged centrally by
          // apiErrorHandler — no need to duplicate its message here, just the
          // newsletter_id so an operator can find the orphaned draft.
          logger.warning(
            req,
            'share_weekly_brief_ambiguous_send_failure',
            'Send failed ambiguously (may have been accepted upstream) — leaving draft newsletter in place for manual review',
            {
              committee_id: committeeId,
              newsletter_id: newsletter.id,
            }
          );
        }
        throw error;
      }

      // The newsletter API only accepts/queues the send here; upstream fan-out
      // runs asynchronously in a detached job and can still fail completely
      // afterward. Log as queued, not sent — an operator reading this event
      // should not treat it as a delivery confirmation.
      logger.info(req, 'share_weekly_brief_queued', 'Weekly brief queued for delivery via newsletter send pipeline', {
        committee_id: committeeId,
        newsletter_id: newsletter.id,
        total_recipients: sendResult.total_recipients,
      });

      return {
        committee_name: committee.name,
        total_recipients: sendResult.total_recipients,
      };
    } finally {
      req.bearerToken = originalTokenForSend;
    }
  }

  /**
   * Shares the current brief to the committee's configured Slack channel. The committee-service
   * itself owns composing and sending the message (lfx-v2-committee-service PR #178 /
   * LFXV2-3094) — it reads the stored `chat_webhook_url` from its own storage and posts to
   * Slack, so the raw credential never needs to reach this BFF. Precondition chain otherwise
   * mirrors {@link shareBrief} (brief exists + shareable state, revision matches, caller is a
   * project writer, `WEEKLY_BRIEF_BACKEND=live`) — those checks stay local so a disabled/mock
   * environment and a stale revision fail the same way they always have, before any upstream
   * call.
   *
   * Known behavior change from the pre-LFXV2-3080-migration send: the posted message is
   * `brief_text` alone — as of this writing, committee-service's `WebhookSender` does not add
   * back the `*Weekly Brief — {committee}* ({date range})` heading this BFF used to prepend
   * before composing moved server-side. Flag to product/upstream if that context is missed in a
   * channel receiving briefs from more than one committee; not addressed in this BFF, since it no
   * longer composes the message at all.
   */
  public async shareToSlack(req: Request, committeeId: string, expectedRevision: number): Promise<ShareWeeklyBriefToSlackResult> {
    // Same server-side kill switch as committee.service.ts's updateCommittee, and for the same
    // reason: WG_WEEKLY_BRIEF_SLACK_FLAG only gates the Angular UI (evaluated through the
    // OpenFeature Web SDK, which never runs server-side) — without this, a project writer could
    // trigger a real Slack send via a direct API call while the UI still hides the action.
    // Checked first, before any upstream call, so a disabled environment fails cheaply.
    if (!isServerFeatureEnabled(ServerFeatureFlag.WeeklyBriefSlack)) {
      throw new ConflictError('Slack webhook sharing is not enabled in this environment', 'FEATURE_DISABLED', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    const { brief } = await this.fetchBriefResponse(req, committeeId);
    if (!brief || !WEEKLY_BRIEF_SHAREABLE_STATES.includes(brief.state)) {
      throw new ResourceNotFoundError('Weekly brief', committeeId, {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }
    if (brief.revision !== expectedRevision) {
      throw new ConflictError('The brief has been updated since you last viewed it. Reload to review the latest version before sharing.', 'REVISION_MISMATCH', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    // Needs project_uid for the strict project-writer check below — a plain GET, not
    // getCommitteeById, since this method reads nothing from its settings/membership/access-check
    // enrichment.
    const committee = await this.microserviceProxy.proxyRequest<Committee | null>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${encodeURIComponent(committeeId)}`,
      'GET'
    );
    if (!committee) {
      throw new ResourceNotFoundError('Committee', committeeId, {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    // Same strict project-writer boundary as shareBrief, for the same reason: sharing is a
    // deliberate, low-frequency action where misattributing a transient access-check outage as a
    // permission denial is worse than the extra strict-variant call. Stricter than the upstream
    // endpoint's own committee-writer enforcement (via Heimdall) — direct committee grants exist
    // independently of project writer (see `getDirectGrantCommittees`), so without this a
    // committee writer who is not a project writer could trigger a send to a webhook they don't
    // control the destination of.
    const isProjectWriter = await this.accessCheckService.checkSingleAccessStrict(req, {
      resource: 'project',
      id: committee.project_uid,
      access: 'writer',
    });
    if (!isProjectWriter) {
      throw new AuthorizationError('Only project writers can share the weekly brief to Slack', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
        code: 'NOT_PROJECT_WRITER',
      });
    }

    // Preconditions above are enforced regardless of backend mode; only the actual send is
    // gated on isLive() — same rationale as shareBrief: mock-mode content must never actually
    // reach committee-service's real Slack-sending path.
    if (!this.isLive(req)) {
      throw new ConflictError('Sharing is not available in this environment (WEEKLY_BRIEF_BACKEND is not "live")', 'BACKEND_NOT_LIVE', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    // The committee-service composes the message, validates/re-reads the stored webhook, and
    // posts to Slack itself — see this method's doc comment. Its response codes are mapped below
    // onto the same client-facing messages/codes this method already used for the equivalent
    // local checks, so the Angular error-handling contract doesn't change.
    logger.debug(req, 'share_weekly_brief_slack', 'Proxying to committee-service', { committee_id: committeeId, revision: expectedRevision });
    try {
      await this.microserviceProxy.proxyRequest<void>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/share-to-chat`,
        'POST',
        undefined,
        { revision: expectedRevision }
      );
    } catch (error) {
      if (!(error instanceof MicroserviceError)) {
        throw error;
      }
      // Logged before remapping — the remapped client-facing error (esp. the 400 case below,
      // which collapses both a stale local/upstream state race AND a genuine BFF↔upstream
      // contract bug to the same "brief not found" 404) would otherwise leave no operator-visible
      // trace of what upstream actually said.
      logger.warning(req, 'share_weekly_brief_slack', 'committee-service rejected the share-to-chat request', {
        committee_id: committeeId,
        upstream_status: error.statusCode,
        upstream_code: error.code,
      });
      switch (error.statusCode) {
        case 400:
          // Race window between the local shareable-state check above and this call landing
          // upstream — same shape as that local check's own 404, not a new error to the client.
          throw new ResourceNotFoundError('Weekly brief', committeeId, {
            operation: 'share_weekly_brief_slack',
            service: 'weekly_brief_service',
          });
        case 403:
          // Defense-in-depth — the strict project-writer check above normally rejects this
          // first; this only fires if Heimdall's committee-writer boundary disagrees with it.
          throw new AuthorizationError('Only project writers can share the weekly brief to Slack', {
            operation: 'share_weekly_brief_slack',
            service: 'weekly_brief_service',
            code: 'NOT_PROJECT_WRITER',
          });
        case 404:
          throw new ResourceNotFoundError('Weekly brief', committeeId, {
            operation: 'share_weekly_brief_slack',
            service: 'weekly_brief_service',
          });
        case 409:
          throw new ConflictError(
            'The brief has been updated since you last viewed it. Reload to review the latest version before sharing.',
            'REVISION_MISMATCH',
            { operation: 'share_weekly_brief_slack', service: 'weekly_brief_service' }
          );
        case 422:
          throw new ConflictError('Committee has no Slack webhook configured', 'NO_SLACK_WEBHOOK', {
            operation: 'share_weekly_brief_slack',
            service: 'weekly_brief_service',
          });
        default:
          throw error;
      }
    }

    // shared_by is the one place this action's actor is recorded at all in this BFF — the
    // committee-service call carries no caller identity beyond the bearer token itself (it's why
    // /share-slack blocks during impersonation in the first place — see
    // impersonation-readonly.middleware.ts). Opaque OIDC sub, not the LFID username, same
    // rationale as rating_recorded above: this log line is retained indefinitely, and a
    // human-readable username is PII (PR #1361 review —
    // docs/reviews/knowledge-base/security.md's `security/pii-in-logs-and-identifiers`).
    logger.info(req, 'share_weekly_brief_slack_sent', 'Weekly brief sent to the committee Slack channel', {
      committee_id: committeeId,
      shared_by: getEffectiveSub(req),
    });

    return {};
  }

  /**
   * Refuses mock mode outright in production instead of silently serving
   * fabricated brief content. `assertCommitteeRead`/`assertCommitteeWrite` gate
   * every request at the controller level regardless of mock or live mode, so a
   * caller without committee access is already rejected before reaching this
   * service — this check instead guards against a *misconfigured deploy*
   * serving fabricated mock content to a legitimately-authorized caller who
   * expects real committee-service data. `WEEKLY_BRIEF_BACKEND` ships unset in
   * `.env.example`, so this is the only thing standing between that
   * misconfiguration and production.
   */
  private isLive(req: Request): boolean {
    const backend = process.env['WEEKLY_BRIEF_BACKEND'];
    if (backend === 'live') {
      return true;
    }
    if (process.env['NODE_ENV'] === 'production') {
      // The env-var name and deploy posture stay out of the client-facing message —
      // only `errorBody` (log-only; MicroserviceError#toResponse never echoes it back
      // except via its `details`/`errors` sub-keys) carries the specific reason.
      throw new MicroserviceError('Weekly brief is temporarily unavailable', 500, 'WEEKLY_BRIEF_MISCONFIGURED', {
        operation: 'weekly_brief_backend_check',
        service: 'weekly_brief_service',
        errorBody: { reason: 'WEEKLY_BRIEF_BACKEND must be "live" in production — refusing to serve mock weekly-brief content' },
      });
    }
    logger.warning(req, 'weekly_brief_mock_mode', 'Serving mock weekly-brief data — WEEKLY_BRIEF_BACKEND is not "live"', {});
    return false;
  }

  /**
   * Shared by `getCurrentBrief` and every internal caller that only needs `brief`/`throttle`/
   * `caller_rating` — `getActionItems`, `shareBrief`, `shareToSlack`, `resolveRatableBrief`.
   * Deliberately does NOT build `current_activity` (see `getCurrentBrief`'s own doc comment for
   * why that stays exclusive to the actual `GET /current` read path — those four callers would
   * otherwise pay a real upstream fan-out for a field they immediately discard).
   *
   * Upstream's own contract is 200-with-null-brief-and-throttle when no draft exists yet for the
   * window — a 404 here means "committee not found", a real error the caller needs to see, not an
   * empty-brief state to paper over.
   */
  private async fetchBriefResponse(req: Request, committeeId: string): Promise<WeeklyBriefCurrentResponse> {
    let response: WeeklyBriefCurrentResponse;
    if (!this.isLive(req)) {
      const brief = currentMockBrief(committeeId);
      response = {
        brief,
        throttle: {
          ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
          generates_used: 1,
          regenerations_used: brief.regeneration_count,
          window_resets_at: nextSundayIso(),
        },
      };
    } else {
      logger.debug(req, 'get_weekly_brief_current', 'Proxying to committee-service', { committee_id: committeeId });
      response = await this.microserviceProxy.proxyRequest<WeeklyBriefCurrentResponse>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`,
        'GET'
      );
    }
    return this.withCallerRating(req, committeeId, response);
  }

  /**
   * Races `buildCurrentActivity` against `WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS` — see that
   * constant's own doc comment for why this exists (a slow, not just an erroring, upstream must
   * not hold the whole `GET /current` response hostage). Resolving to `undefined` on a lost race,
   * not rejecting, is deliberate: it's the same value `buildCurrentActivity` itself already
   * produces for any other transient failure, so `getCurrentBrief`'s caller — and the client's
   * poll self-heal — can't tell a timeout apart from any other degrade, and don't need to. Still
   * warns when the budget is the one that wins, matching this method's every sibling exit
   * (`buildCurrentActivity` itself warns on each of its own omit-the-tally paths) — otherwise a
   * budget that starts firing regularly in production would be invisible in CloudWatch. A
   * dedicated sentinel (not plain `undefined`) distinguishes "the budget elapsed" from
   * "`buildCurrentActivity` itself resolved to `undefined` well within budget", which needs no
   * warning of its own (it already logs its own reason for degrading). The loser of the race is
   * not cancelled (`buildCurrentActivity` has no cancellation hook — its underlying upstream
   * calls keep running until they settle or their own timeout fires).
   *
   * The `catch` below is this method's OWN fail-soft guarantee, not defense-in-depth borrowed
   * from `buildCurrentActivity`'s: `Promise.race` rejects if whichever promise wins the race
   * rejects, and a `try/finally` with no `catch` re-throws, which would fail this method — and
   * therefore `getCurrentBrief`'s whole `Promise.all` (the brief itself, not just the tally) —
   * even though `buildCurrentActivity`'s own try/catch means that path isn't reachable as written
   * today. This method doesn't lean on that distant invariant staying true; it degrades to
   * `undefined` and warns on any rejection it sees directly, the same way it already does for a
   * lost race.
   */
  private async buildCurrentActivityWithBudget(req: Request, committeeId: string): Promise<WeeklyBriefCurrentActivity | null | undefined> {
    const BUDGET_ELAPSED = Symbol('current_activity_budget_elapsed');
    let timer: NodeJS.Timeout;
    const timeout = new Promise<typeof BUDGET_ELAPSED>((resolve) => {
      timer = setTimeout(() => resolve(BUDGET_ELAPSED), WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS);
    });
    const result = this.buildCurrentActivity(req, committeeId);
    result.catch(() => undefined);
    try {
      const winner = await Promise.race([result, timeout]);
      if (winner === BUDGET_ELAPSED) {
        logger.warning(req, 'get_weekly_brief_current_activity', 'Current-activity budget elapsed, omitting the tally', {
          committee_id: committeeId,
          budget_ms: WEEKLY_BRIEF_CURRENT_ACTIVITY_BUDGET_MS,
        });
        return undefined;
      }
      return winner;
    } catch (err) {
      logger.warning(req, 'get_weekly_brief_current_activity', 'Current-activity fan-out rejected unexpectedly, omitting the tally', {
        committee_id: committeeId,
        err,
      });
      return undefined;
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Builds `WeeklyBriefCurrentResponse.current_activity` (GH-1922) from
   * `CommitteeActivityService.getCommitteeActivity` — the same live meeting/vote/document
   * aggregation that powers the committee "Recent Activity" feed, filtered to the current,
   * not-yet-closed week. Gated to governance (Board/Government Advisory Council) committees only
   * — the only ones the client renders the tally for — so a non-Board committee's weekly-brief
   * load never pays for `getCommitteeActivity`'s own 9-call upstream fan-out. The gating read
   * itself is `getCommitteeBase` (a single plain GET), not `getCommitteeById` — this needs the
   * base record alone, and `getCommitteeById`'s default options cost three upstream calls
   * (base GET, settings, an access-check) for data this call would only discard. The resolved
   * committee is then passed into `getCommitteeActivity` below as its `knownCommittee` — that
   * method's own `fetchCommittee` leg needs the same record (for `enable_voting`), and without
   * passing it down explicitly a governance committee's weekly-brief load would pay for the
   * identical `GET /committees/:id` twice. `getCommitteeBase` performs no access check of its
   * own — safe here only because this method's one caller, `getCurrentBrief`, is reachable
   * exclusively through the controller's `assertCommitteeRead` gate; a new caller of
   * `getCommitteeBase` would need its own. Fails soft to `undefined` (never an empty array) on a
   * genuine error — see `WeeklyBriefCurrentResponse.current_activity`'s doc comment
   * (`@lfx-one/shared/interfaces`) for the full absent/null/present contract that puts `undefined`
   * here in context; not re-derived in this method. `undefined`'s three actual causes, specific
   * to this method and not part of that shared contract: `getCommitteeBase` resolves with no
   * body at all; it resolves with a committee that carries no usable `category`; or any other
   * error thrown while building the tally, caught below.
   *
   * `limit: ACTIVITY_FEED_MAX_PAGE_SIZE` is a single, unfollowed page — `getCommitteeActivity`
   * hard-rejects any larger `limit`, so that's the ceiling one call can ever return. Deliberately
   * NOT gated on the returned `page_token`/its underlying `anyLegSaturated` flag: two of the five
   * legs (`fetchNotesAddedEvents`, `fetchSurveyEvents`) never push `since` upstream at all (see
   * their own doc comments in `committee-activity.service.ts` for why), so they fetch each
   * committee's newest `fetchSize` rows by `updated_desc` and filter to the window in memory —
   * their own `saturated` flag reflects whether the committee has more than `fetchSize` *lifetime*
   * notes/surveys, not whether THIS WEEK's activity was truncated. Gating on that would silently
   * hide the tally for exactly the long-lived, active committees it exists to help.
   *
   * Gate on `data.length` instead — the merged, window-filtered, already-capped-at-`limit` result:
   * when it fills the page (`>= limit`), real in-window rows may have been cut, so this returns
   * `null` (a settled "can't state a count as fact" answer, not a transient "couldn't determine")
   * rather than a truncated count stated as fact — see
   * `WeeklyBriefCurrentResponse.current_activity`'s doc comment for why `null` here, not
   * `undefined`.
   *
   * Known v1 residual (accepted, not solved): `data.length < limit` is a heuristic, not a proof of
   * completeness. `committee-activity.service.ts` documents — in its own "Filter dimension" (its
   * exact label), sort-dimension ("Votes, surveys, files, and notes are all in a different,
   * genuinely-approximate bucket"), and FGA-post-filter comments — several ways an individual leg's
   * single upstream page can under-report while the merged, capped `data.length` still lands under
   * `limit`. Deliberately not re-derived here leg-by-leg — a summary of which mechanism hits which
   * leg is exactly the kind of detail that silently drifts out of sync with its source as that
   * source evolves, and none of it crosses the `getCommitteeActivity` boundary as a signal this
   * caller could gate on regardless: only a single merged `page_token` comes back, no per-leg flag.
   * Closing this for real would need `getCommitteeActivity` to expose a per-leg completeness signal
   * it doesn't return today — not done here to avoid changing the public contract of an endpoint
   * the real "Recent Activity" feed also consumes, for a v1 tally where this is already a narrow
   * edge case relative to the `page_token`/`anyLegSaturated` gate this replaced (which fired on
   * nearly every long-lived board, every week).
   */
  private async buildCurrentActivity(req: Request, committeeId: string): Promise<WeeklyBriefCurrentActivity | null | undefined> {
    try {
      logger.debug(req, 'get_weekly_brief_current_activity', 'Building current-week activity tally', { committee_id: committeeId });
      const committee = await this.committeeService.getCommitteeBase(req, committeeId);
      if (committee === undefined) {
        logger.warning(req, 'get_weekly_brief_current_activity', 'Committee lookup returned nothing, omitting the tally', { committee_id: committeeId });
        return undefined;
      }
      // Falsy, not just `=== undefined` — a resolved committee with no `category` (its type
      // declares `category` required — committee.interface.ts — but that's a contract on
      // well-formed upstream data, not a runtime guarantee against a malformed body) is
      // unclassifiable the same way `getGroupBehavioralClass` itself already treats `undefined`,
      // `null`, and `''` identically (`if (!category) return 'other'` — committee.utils.ts). A
      // genuine 404/upstream error throws instead and is caught below, same as any other failure
      // in this method. Either way this is an anomaly, not a governance verdict, so it falls
      // through to undefined rather than being asserted as "not governance" —
      // isGoverningBoard('')/isGoverningBoard(undefined) both return false, which would settle
      // this to `null` (permanent) for what might just be a transient partial response, worth
      // asking again on the next poll tick.
      if (!committee.category) {
        logger.warning(req, 'get_weekly_brief_current_activity', 'Committee resolved with no usable category, omitting the tally', {
          committee_id: committeeId,
        });
        return undefined;
      }
      // null, not undefined — see WeeklyBriefCurrentResponse.current_activity's doc comment.
      // This committee will never become governance-classified mid-poll, so a caller (the
      // client's pollUntilTerminal) can treat this as a settled answer and stop asking.
      if (!isGoverningBoard(committee.category)) return null;

      const { window_start, window_end } = currentWeekInProgressWindow();
      // Passing `committee` (already resolved above) as getCommitteeActivity's knownCommittee —
      // see this method's own doc comment for why. `quietAggregationLog: true` separately, since
      // this is a per-poll-tick call, not the controller-driven feed read that method's own
      // INFO-logging rationale is written for — see that call site's own comment.
      const { data } = await this.committeeActivityService.getCommitteeActivity(
        req,
        committeeId,
        {
          since: window_start,
          limit: ACTIVITY_FEED_MAX_PAGE_SIZE,
        },
        { knownCommittee: committee, quietAggregationLog: true }
      );
      logger.debug(req, 'get_weekly_brief_current_activity', 'Fetched current-week activity', { committee_id: committeeId, event_count: data.length });
      if (data.length >= ACTIVITY_FEED_MAX_PAGE_SIZE) {
        logger.warning(
          req,
          'get_weekly_brief_current_activity',
          'Current-week activity fills a full page — publishing null (settled, not a count) rather than a truncated count stated as fact',
          {
            committee_id: committeeId,
          }
        );
        // null, not undefined — more in-window activity only ever accumulates within a poll
        // cycle, never un-fills a full page, so this can't resolve differently on a later tick
        // within the same cycle either.
        return null;
      }

      // Filtered to occurred_at <= window_end, not just >= window_start (the `since` param
      // above already narrows that half) — getCommitteeActivity has no `before`/upper-bound
      // param of its own, and the vote leg can report an occurred_at arbitrarily far ahead of
      // "now": a vote administratively ended (status ENDED) with its own end_time still in the
      // future stamps occurred_at from that future end_time (see mapVoteToEvent). The survey
      // leg's cutoff-driven occurred_at can NOT do the same — isCutoffDrivenClosure
      // (committee-activity.service.ts) only adopts a cutoff once it's already passed, so the
      // most it can exceed window_end by is this request's own in-flight latency between
      // snapshotting window_end (above) and evaluating the cutoff, not an arbitrary future value.
      // Without this filter, window_end would advertise a bound the response doesn't actually
      // honor. Numeric (Date.parse), not string, comparison —
      // matches committee-activity.service.ts's own timestampValue convention rather than
      // assuming every occurred_at is byte-identically formatted to window_end's toISOString()
      // output. An unparseable occurred_at (NaN) is let through rather than dropped — unreachable
      // through getCommitteeActivity today (its own merge pass already drops unparseable
      // timestamps via timestampValue !== -Infinity), kept so this filter stays correct on its
      // own terms if that ever changes, same rationale as mapActivityEventToCurrentActivityRef's
      // own "unreached in practice, not dead by construction" default branch.
      const windowEndMs = Date.parse(window_end);
      let droppedAfterWindowEnd = 0;
      const sourceRefs = data.reduce<WeeklyBriefSourceRef[]>((refs, event) => {
        const eventMs = Date.parse(event.occurred_at);
        if (!Number.isNaN(eventMs) && eventMs > windowEndMs) {
          droppedAfterWindowEnd += 1;
          return refs;
        }
        const ref = mapActivityEventToCurrentActivityRef(event);
        if (ref) refs.push(ref);
        return refs;
      }, []);
      // DEBUG, not WARN — the vote leg's occurred_at-ahead-of-"now" case (see the filter's own
      // comment above) is a mapVoteToEvent-modeled, expected shape, not an anomaly: an
      // administratively-ENDED vote with no early_end_time stamps occurred_at from its still-future
      // end_time deliberately, and stays that way for the rest of that vote's scheduled term — so a
      // WARN here would repeat on every GET /current for that committee for a case the system
      // already knows about and models on purpose, not a genuine data-quality problem worth an
      // operator's attention. Still logged (not silent) since a drop is still worth being able to
      // find while debugging a tally that looks short.
      if (droppedAfterWindowEnd > 0) {
        logger.debug(req, 'get_weekly_brief_current_activity', 'Dropped one or more events stamped after window_end', {
          committee_id: committeeId,
          dropped_count: droppedAfterWindowEnd,
          window_end,
        });
      }
      return { window_start, window_end, source_refs: sourceRefs };
    } catch (err) {
      logger.warning(req, 'get_weekly_brief_current_activity', 'Failed to build current-week activity tally, omitting it', {
        committee_id: committeeId,
        err,
      });
      // undefined, not null — this failure is transient (a lookup/fetch error), unlike the two
      // null cases above, so a caller is right to ask again.
      return undefined;
    }
  }

  /**
   * Enriches a `fetchBriefResponse` result (called from both `getCurrentBrief` and every other
   * internal caller that needs `brief`/`caller_rating`) with the caller's own rating on that
   * exact brief revision (LFXV2-3042). Fails soft on every edge: no brief, no resolvable
   * username, or a cache miss/fault all resolve to `caller_rating: null` rather than throwing —
   * this is a convenience read for the UI's pre-lit thumb state, not a precondition for anything.
   */
  private async withCallerRating(req: Request, committeeId: string, response: WeeklyBriefCurrentResponse): Promise<WeeklyBriefCurrentResponse> {
    if (!response.brief) return response;
    const username = getEffectiveUsername(req);
    if (!username) return response;
    const key = buildWeeklyBriefRatingCacheKey(committeeId, response.brief.uid, response.brief.revision, username);
    if (!key) return response;
    const stored = await valkeyService.getJson<RateWeeklyBriefResponse>(key, isStoredRating);
    return { ...response, caller_rating: stored?.rating ?? null };
  }

  /**
   * Resolves and validates the brief a rate/clear-rating call targets. Re-fetches the current
   * brief (rather than trusting anything client-supplied beyond `briefUid`) so `revision`/
   * `prompt_version`/`model` in the rating log are always the server's own values. Guards that
   * `briefUid` still names the committee's current brief — e.g. a window rollover produced a new
   * brief_uid between page load and tap — same "existence, not the write itself" gap this closes
   * as `assertCommitteeRead` closes for reads. Also requires the brief be in a shareable state
   * (`generated`/`edited`/`approved`), same set and same 404 shape `shareBrief` already uses for
   * "no reviewable content to act on" — the UI only ever renders the rating control in those
   * states, but a direct API call must not be able to record a rating against a brief that's
   * still `generating`, `error`, or `empty`.
   *
   * `expectedRevision` — the revision the caller actually rendered when they tapped — must match
   * the server-resolved current revision, or this throws a 409 (`REVISION_MISMATCH`, same
   * shape/code `shareBrief` already uses). Without this, a stale tab whose displayed content moved
   * on (a co-chair's edit or regenerate landed between page load and tap) would silently rate/clear
   * the *new* revision while the user only ever saw the old one — both misattributing the vote in
   * the durable analytics log (wrong `prompt_version`/`model`) and, on a later refresh, pre-lighting
   * the thumb against content the rater never actually reviewed (PR #1361 review). Matches the
   * optimistic-concurrency contract `saveBrief`/`shareBrief` already enforce for their own writes.
   *
   * Also returns the brief's `caller_rating` (already resolved by `fetchBriefResponse` →
   * `withCallerRating` for this exact key) as `callerRating`, so `rateBrief`/`clearBriefRating`
   * can use it as `previous_rating` in their log line without a second, identical Valkey read for
   * a key this call already read.
   */
  private async resolveRatableBrief(
    req: Request,
    committeeId: string,
    briefUid: string,
    expectedRevision: number,
    operation: string
  ): Promise<{ brief: WeeklyBrief; callerRating: WeeklyBriefRating | null }> {
    const response = await this.fetchBriefResponse(req, committeeId);
    const { brief } = response;
    if (!brief || brief.uid !== briefUid || !WEEKLY_BRIEF_SHAREABLE_STATES.includes(brief.state)) {
      throw new ResourceNotFoundError('Weekly brief', briefUid, { operation, service: 'weekly_brief_service' });
    }
    if (brief.revision !== expectedRevision) {
      throw new ConflictError('This brief has changed since you last viewed it. Reload to review the latest version before rating.', 'REVISION_MISMATCH', {
        operation,
        service: 'weekly_brief_service',
      });
    }
    return { brief, callerRating: response.caller_rating ?? null };
  }

  /** Resolves the effective username for a rating write, or throws — a rating with no identity to scope it to is a genuine failure, not something to degrade silently (unlike the read-side `withCallerRating`). */
  private requireUsername(req: Request, operation: string): string {
    const username = getEffectiveUsername(req);
    if (!username) {
      throw new AuthenticationError('Unable to resolve your account for this action', { operation, service: 'weekly_brief_service' });
    }
    return username;
  }

  /** Resolves the rating cache key, or throws if the committee/brief uid or username aren't filter-safe — `assertCommitteeRead` + `validateUidParameter` make this practically unreachable, but a rating write must not silently no-op against a null key. */
  private requireRatingKey(committeeId: string, briefUid: string, revision: number, username: string, operation: string): string {
    const key = buildWeeklyBriefRatingCacheKey(committeeId, briefUid, revision, username);
    if (!key) {
      throw ServiceValidationError.forField('briefUid', 'Unable to build a rating key for this brief/user', { operation, service: 'weekly_brief_service' });
    }
    return key;
  }

  /**
   * Upstream's 409 (`edited_brief_exists`, carries `revision`) and 429
   * (`throttle_exceeded`, carries the throttle counters) bodies use field
   * names `MicroserviceError#toResponse` doesn't forward by default (only
   * `details`/`errors` survive). Re-wrap so the client can render the
   * specific conflict/throttle info instead of a generic message.
   */
  private withConflictBody(error: unknown): unknown {
    if (error instanceof MicroserviceError && (error.statusCode === 409 || error.statusCode === 429) && error.errorBody) {
      return new MicroserviceError(error.message, error.statusCode, error.code, {
        operation: error.operation,
        service: error.service,
        path: error.path,
        originalMessage: error.originalMessage,
        errorBody: { details: error.errorBody },
      });
    }
    return error;
  }
}
