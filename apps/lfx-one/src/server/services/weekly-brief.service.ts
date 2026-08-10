// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_BODY_MAX_LENGTH,
  NEWSLETTER_SUBJECT_MAX_LENGTH,
  SLACK_INCOMING_WEBHOOK_URL_PATTERN,
  SLACK_MESSAGE_TEXT_MAX_LENGTH,
  SLACK_WEBHOOK_POST_TIMEOUT_MS,
  VALKEY_CACHE,
  WEEKLY_BRIEF_ACTION_ITEMS_MAX,
  WEEKLY_BRIEF_DEFAULT_THROTTLE,
  WEEKLY_BRIEF_ERROR_REASON,
  WEEKLY_BRIEF_SHAREABLE_STATES,
} from '@lfx-one/shared/constants';
import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  GetWeeklyBriefActionItemsResponse,
  Newsletter,
  NewsletterSendResult,
  RateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  ShareWeeklyBriefResult,
  ShareWeeklyBriefToSlackResult,
  WeeklyBrief,
  WeeklyBriefActionItem,
  WeeklyBriefCurrentResponse,
  WeeklyBriefRating,
} from '@lfx-one/shared/interfaces';
import { formatUtcDateRangeLabel } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { WEEKLY_BRIEF_MOCK_QUIET_WEEK_COMMITTEE_UID } from '../constants';
import { AuthenticationError, AuthorizationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';

import { AccessCheckService } from './access-check.service';
import { AiService } from './ai.service';
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
 * Escapes Slack mrkdwn control characters per Slack's own escaping rules
 * (https://api.slack.com/reference/surfaces/formatting#escaping) — `&`, `<`, `>` are the only
 * three that matter. Slack's incoming webhooks parse `text` as mrkdwn by default: an unescaped
 * `<!channel>`/`<!here>` anywhere in `brief_text` (AI-generated from meeting/document titles —
 * content a broader set of users than project writers can influence, then further editable by
 * writers) would page the entire channel, and `<https://evil.example|label>` would render as a
 * deceptive hyperlink.
 */
function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function buildMockBrief(committeeId: string, overrides: Partial<WeeklyBrief> = {}): WeeklyBrief {
  const nowIso = new Date().toISOString();
  const { window_start, window_end } = briefWindow();
  return {
    uid: 'wb_mock_00000000-0000-0000-0000-000000000001',
    committee_uid: committeeId,
    window_start,
    window_end,
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
  private newsletterService: NewsletterService = new NewsletterService();
  private accessCheckService: AccessCheckService = new AccessCheckService();
  private aiService: AiService = new AiService();

  /**
   * GET /committees/:committeeId/weekly-briefs/current
   *
   * Upstream's own contract is 200-with-null-brief-and-throttle when no draft
   * exists yet for the window — a 404 here means "committee not found", a
   * real error the caller needs to see, not an empty-brief state to paper
   * over.
   */
  public async getCurrentBrief(req: Request, committeeId: string): Promise<WeeklyBriefCurrentResponse> {
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
    const { brief } = await this.getCurrentBrief(req, committeeId);
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
   */
  public async shareBrief(req: Request, committeeId: string, expectedRevision: number): Promise<ShareWeeklyBriefResult> {
    const { brief } = await this.getCurrentBrief(req, committeeId);
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
    // committee.writer is a superset of what we need here — per committee.interface.ts's
    // own doc comment, it's true for both a direct committee-level grant AND an inherited
    // project writer, but the newsletter service (which this repurposes for delivery)
    // only recognizes project:{project_uid}#writer. A direct-grant-only committee writer
    // would pass committee.writer, then 403 from the newsletter service — and there's no
    // delegated/on-behalf-of token mechanism in this codebase to bridge that gap without
    // misattributing the send (the newsletter service resolves the sender's display name
    // from the signed JWT principal; an M2M token has none). Check the actual boundary
    // directly instead, with the caller's own bearer token.
    //
    // checkSingleAccessStrict, not checkSingleAccess — the non-strict variant degrades a
    // transient access-check outage to "no access", which would surface here as a
    // misleading 403 NOT_PROJECT_WRITER instead of a retryable error. Sharing is a
    // deliberate, low-frequency action (unlike a list-view access annotation, where
    // fail-closed-to-false is an acceptable trade-off), so misattributing an outage as a
    // permission denial is worse here — same rationale as committee-access.internal.helper.ts's
    // existing use of the strict variant.
    const isProjectWriter = await this.accessCheckService.checkSingleAccessStrict(req, {
      resource: 'project',
      id: committee.project_uid,
      access: 'writer',
    });
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
    const edReplyEmail = getEffectiveEmail(req);
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

    // isProjectWriter (checked above) is the newsletter service's actual authorization
    // boundary, so the caller's own bearer token is used as-is here — no token swap at
    // this layer (see NewsletterServiceClient#sendNewsletter's doc comment). The sender's
    // display name resolves from that token's JWT principal — which, under impersonation,
    // is the TARGET's principal, since auth.middleware.ts has already swapped
    // req.bearerToken to the impersonation token by the time this method runs (known
    // pre-existing gap, tracked in LFXV2-3093; see weekly-brief.route.ts's /share comment).
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
  }

  /**
   * Shares the current brief to the committee's configured Slack channel via an Incoming
   * Webhook POST. Precondition chain mirrors {@link shareBrief} exactly (brief exists +
   * shareable state, revision matches, caller is a project writer, `WEEKLY_BRIEF_BACKEND=live`)
   * with one swap: "has a mailing list configured" becomes "has a Slack webhook configured".
   *
   * Unlike shareBrief's newsletter-service handoff (async accept-then-fan-out), a webhook POST
   * is synchronous — Slack's own response is authoritative. A resolved promise means Slack
   * accepted the message, not that it was merely queued.
   */
  public async shareToSlack(req: Request, committeeId: string, expectedRevision: number): Promise<ShareWeeklyBriefToSlackResult> {
    const { brief } = await this.getCurrentBrief(req, committeeId);
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

    // One fetch, not two: getCommitteeForSlackShare returns exactly what this method needs
    // (name, project_uid, the raw webhook URL) from a single upstream call — going through
    // getCommitteeById (settings/membership/access-check enrichment this method never reads)
    // plus a second, separate getSlackWebhookUrlStrict call would cost an extra round trip and
    // open a TOCTOU window on the webhook value between the two reads. See
    // getSlackWebhookUrlStrict's doc comment for the full rationale.
    const committee = await this.committeeService.getCommitteeForSlackShare(req, committeeId);

    // Same strict project-writer boundary as shareBrief, for the same reason: sharing is a
    // deliberate, low-frequency action where misattributing a transient access-check outage as
    // a permission denial is worse than the extra strict-variant call.
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

    // Re-validated against SLACK_INCOMING_WEBHOOK_URL_PATTERN here, not just trusted from
    // upstream storage — the BFF's own updateCommittee is not the only possible writer of
    // chat_webhook_url on the committee record (any client with a token can PUT /committees/:uid
    // directly), so the stored value is untrusted input at the point of use. Without this, an
    // arbitrary URL written some other way would turn this into a server-initiated POST of brief
    // content to an attacker-chosen destination — exactly what the allowlist exists to prevent.
    // A malformed value is treated the same as "not configured" — from the caller's perspective
    // both are equally unactionable.
    const webhookUrl = committee.chat_webhook_url;
    const isAllowedWebhook = !!webhookUrl && SLACK_INCOMING_WEBHOOK_URL_PATTERN.test(webhookUrl);
    if (webhookUrl && !isAllowedWebhook) {
      // Logged, not put in the thrown error's `metadata` — BaseApiError.toResponse() serializes
      // `metadata` straight into the client-facing JSON body, which would let the response leak
      // "something is stored" vs. "nothing is configured" per committee. The caller-facing
      // message/code must stay byte-identical either way; this operator-only signal (never the
      // URL itself) is the one place that distinction is allowed to exist.
      logger.warning(req, 'share_weekly_brief_slack', 'Stored chat_webhook_url failed the Slack allowlist — treating as unconfigured', {
        committee_id: committeeId,
      });
    }
    if (!isAllowedWebhook) {
      throw new ConflictError('Committee has no Slack webhook configured', 'NO_SLACK_WEBHOOK', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    // Preconditions above are enforced regardless of backend mode; only the actual send is
    // gated on isLive() — same rationale as shareBrief: mock-mode content must never actually
    // post to a real Slack channel.
    if (!this.isLive(req)) {
      throw new ConflictError('Sharing is not available in this environment (WEEKLY_BRIEF_BACKEND is not "live")', 'BACKEND_NOT_LIVE', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    const text = `*Weekly Brief — ${escapeSlackMrkdwn(committee.name)}* (${formatUtcDateRangeLabel(brief.window_start, brief.window_end)})\n\n${escapeSlackMrkdwn(brief.brief_text)}`;
    // [...text].length, not text.length — counts Unicode code points, not UTF-16 code units,
    // matching how the controller validates this same brief_text field on save
    // (weekly-brief.controller.ts's [...b['brief_text']].length check against
    // WEEKLY_BRIEF_TEXT_MAX_LENGTH). A raw .length would disagree with that check for an
    // emoji-heavy brief.
    if ([...text].length > SLACK_MESSAGE_TEXT_MAX_LENGTH) {
      // Phrased in terms of shortening the brief, not the post-escaping/post-header character
      // ceiling above — that number (40,000) would be confusing next to the brief editor's own
      // much smaller cap (WEEKLY_BRIEF_TEXT_MAX_LENGTH, 20,000).
      throw ServiceValidationError.forField('brief_text', 'Brief is too long to share to Slack. Shorten the brief text and try again.', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
      });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      // A redirect response could relocate the POST body off hooks.slack.com entirely —
      // 'error' rejects the fetch outright instead of silently following it.
      redirect: 'error',
      signal: AbortSignal.timeout(SLACK_WEBHOOK_POST_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw new MicroserviceError('Unable to reach Slack — the webhook request failed or timed out', 502, 'SLACK_UNREACHABLE', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
        originalError: error instanceof Error ? error : undefined,
      });
    });

    if (!response.ok) {
      // Slack's incoming-webhook error responses are a plain-text body (e.g. `invalid_payload`,
      // `channel_not_found`, `action_prohibited`), not JSON.
      const slackErrorText = await response.text().catch(() => '');
      throw new MicroserviceError(`Slack rejected the message${slackErrorText ? `: ${slackErrorText}` : ''}`, 502, 'SLACK_SEND_FAILED', {
        operation: 'share_weekly_brief_slack',
        service: 'weekly_brief_service',
        errorBody: { reason: slackErrorText || 'unknown error' },
      });
    }

    logger.info(req, 'share_weekly_brief_slack_sent', 'Weekly brief sent to the committee Slack channel', {
      committee_id: committeeId,
    });

    return { committee_name: committee.name };
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
   * Enriches a `getCurrentBrief` result with the caller's own rating on that exact brief
   * revision (LFXV2-3042). Fails soft on every edge: no brief, no resolvable username, or a
   * cache miss/fault all resolve to `caller_rating: null` rather than throwing — this is a
   * convenience read for the UI's pre-lit thumb state, not a precondition for anything.
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
   * Also returns the brief's `caller_rating` (already resolved by `getCurrentBrief` →
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
    const response = await this.getCurrentBrief(req, committeeId);
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
