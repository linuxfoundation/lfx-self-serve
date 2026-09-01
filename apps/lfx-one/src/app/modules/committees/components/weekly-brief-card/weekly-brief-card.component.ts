// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { WeeklyBriefArchiveDrawerComponent } from '../weekly-brief-archive-drawer/weekly-brief-archive-drawer.component';
import { SourceChipContextDirective } from './source-chip-context.directive';
import {
  WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS,
  WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES,
  WEEKLY_BRIEF_ERROR_REASON,
  WEEKLY_BRIEF_MAX_POLL_ATTEMPTS,
  WEEKLY_BRIEF_POLL_INTERVAL_MS,
  WEEKLY_BRIEF_SHAREABLE_STATES,
  WEEKLY_BRIEF_SOURCE_SECTIONS,
  WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD,
  WEEKLY_BRIEF_TERMINAL_STATES,
  WEEKLY_BRIEF_TEXT_MAX_LENGTH,
  WG_WEEKLY_BRIEF_SLACK_FLAG,
} from '@lfx-one/shared/constants';
import {
  Committee,
  PaginatedResponse,
  ShareWeeklyBriefResult,
  ValidationError,
  WeeklyBrief,
  WeeklyBriefCurrentActivitySection,
  WeeklyBriefCurrentResponse,
  WeeklyBriefRating,
  WeeklyBriefSourceChip,
  WeeklyBriefSourceChipAction,
  WeeklyBriefSourceChipSection,
  WeeklyBriefStaleness,
  WeeklyBriefThrottle,
} from '@lfx-one/shared/interfaces';
import { formatUtcDateRangeLabel, isGoverningBoard, mapWeeklyBriefSourceRefsToChips } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { WeeklyBriefService } from '@services/weekly-brief.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  Observable,
  of,
  skip,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  timeout,
  TimeoutError,
  timer,
} from 'rxjs';

@Component({
  selector: 'lfx-weekly-brief-card',
  imports: [
    CardComponent,
    ButtonComponent,
    SkeletonModule,
    ReactiveFormsModule,
    TextareaComponent,
    ConfirmDialogModule,
    TagComponent,
    WeeklyBriefArchiveDrawerComponent,
    NgTemplateOutlet,
    SourceChipContextDirective,
  ],
  templateUrl: './weekly-brief-card.component.html',
  styleUrl: './weekly-brief-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyBriefCardComponent {
  // Injections
  private readonly weeklyBriefService = inject(WeeklyBriefService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);

  // Outputs — 'tab'/'vote-drawer' source-ref actions bubble up so the parent can drive its
  // own tab/drawer state (mirrors committee-overview.component.ts's identically-shaped
  // tabNavigated output and openVoteDrawer method for its activity feed, both of which this
  // binds straight through to).
  public readonly tabNavigated = output<string>();
  public readonly voteDrawerRequested = output<string>();

  // Rating is server-blocked during impersonation (rateBrief/clearBriefRating resolve the
  // impersonated user's own identity for the write — see weekly-brief.route.ts's
  // blockDuringImpersonation comment) — surfaced here too so the buttons render
  // visible-but-disabled instead of firing a request that 403s into a misleading generic
  // "Rating failed" toast. Matches the established pattern (profile-panel, account-settings,
  // etc.) of gating on `userService.impersonating()` directly, not on module input plumbing.
  public readonly impersonating = this.userService.impersonating;

  // Same dark-launch gate as committee-settings-tab.component.ts's Slack webhook card — without
  // it, once wg-weekly-brief is on, every user would see a Share to Slack button pointing at
  // settings UI (the webhook card) that's itself still flag-hidden, with no way to configure it.
  public readonly slackShareEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(WG_WEEKLY_BRIEF_SLACK_FLAG, false);

  // Template-bound constant — mirrors upstream's brief_text bound so the editor can't
  // produce a save the BFF is guaranteed to reject.
  protected readonly briefTextMaxLength = WEEKLY_BRIEF_TEXT_MAX_LENGTH;

  // Template-bound constant (LFXV2-3335) — templates can't reference a bare imported
  // constant, so this is re-exposed as a class field for the collapse-threshold comparison.
  protected readonly sourcesCollapseThreshold = WEEKLY_BRIEF_SOURCES_COLLAPSE_THRESHOLD;

  // Reactive form for the editor textarea — `lfx-textarea` requires a FormGroup + control name.
  public readonly editForm = new FormGroup({
    briefText: new FormControl('', { nonNullable: true }),
  });

  // UI state signals
  public readonly fetchLoading = signal(true);
  public readonly fetchError = signal(false);
  public readonly generating = signal(false);
  // True once the poll's attempt cap trips without ever observing a terminal state —
  // the generating branch would otherwise be a permanent dead end with no way out
  // short of a page reload. See pollUntilTerminal.
  public readonly pollTimedOut = signal(false);
  public readonly saving = signal(false);
  public readonly sharing = signal(false);
  public readonly sharingSlack = signal(false);
  public readonly editMode = signal(false);
  // True while a rate/clear-rating request is in flight — guards against a second tap
  // racing the first before the optimistic state has settled.
  public readonly ratingPending = signal(false);

  // Archive drawer visibility and availability signals.
  // `hasArchiveBriefs` starts false and is set by a limit=1 preflight that fires as soon
  // as the committee is known — avoids showing a "Past Briefs" button that opens to an
  // empty drawer (LFXV2-3046: hide the affordance when no past briefs exist).
  public readonly archiveVisible = signal(false);
  public readonly hasArchiveBriefs = signal(false);

  // Sources row disclosure state (LFXV2-3335). Level 1: whether the whole row is expanded
  // past the collapse threshold. Level 2: which individual group chips (keyed by chip id)
  // have their collapsed instances expanded.
  public readonly sourcesExpanded = signal(false);
  public readonly expandedSourceGroups = signal<Set<string>>(new Set());

  // "This week so far" activity-tally disclosure state (GH-1922) — same click-to-reveal
  // shape as expandedSourceGroups above, keyed by kind instead of chip id.
  public readonly expandedActivityKinds = signal<Set<string>>(new Set());

  // Written by both the initial-load pipeline and the post-generate poll (see
  // initBriefResponseSubscription / pollUntilTerminal) — a plain signal rather than
  // toSignal(), since the poll needs to push updates outside that pipeline's own stream.
  private readonly briefResponse = signal<WeeklyBriefCurrentResponse | null>(null);

  // Optimistic rating overlay, keyed to the exact brief (uid + revision) it applies to.
  // `revision` alone isn't enough: a brand-new brief (new `uid`, e.g. after a window
  // rollover) restarts at revision 1 same as the last one, so a revision-only key would
  // wrongly light a fresh, never-rated brief just because it happens to share a revision
  // number with a previously-rated one. Also explicitly cleared (see
  // initBriefResponseSubscription / pollUntilTerminal) whenever a fresh authoritative GET
  // lands — otherwise a silent server-side persist failure (rateBrief still returns 200
  // while its Valkey write no-ops) would leave the thumb lit forever, surviving even a
  // manual refresh, since the overlay would keep overriding the server's real (unrated)
  // caller_rating.
  private readonly optimisticRating = signal<{ briefUid: string; revision: number; value: WeeklyBriefRating | null } | null>(null);

  // Refresh trigger consumed by initBriefResponseSubscription — declared here (not
  // further down with the other private helpers) because @typescript-eslint/member-ordering
  // requires all fields, public or private, before the constructor.
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // Shared by initBriefResponseSubscription and pollUntilTerminal — a field initializer
  // runs in this component's injection context automatically, so this needs no explicit
  // Injector. pollUntilTerminal calling toObservable(this.committee) itself would create
  // a fresh, never-cleaned-up effect (Angular releases it only on component destroy) on
  // every single generate/regenerate/load-into-generating call, not just once.
  private readonly committee$ = toObservable(this.committee);

  // Guards against starting a second concurrent poll — pollUntilTerminal is reachable
  // both from onGenerate and from the initial-load pipeline (a page load / navigation
  // landing on an already-`generating` brief).
  private pollActive = false;

  // Derived signals
  public readonly brief: Signal<WeeklyBrief | null> = computed(() => this.briefResponse()?.brief ?? null);
  public readonly throttle: Signal<WeeklyBriefThrottle | null> = computed(() => this.briefResponse()?.throttle ?? null);

  // brief() is truthy even in the `empty` state (a real WeeklyBrief object with
  // state: 'empty'), which would otherwise fall through into the generated-content
  // branch below — rendering Regenerate/Edit/Copy & Share over zero brief text.
  public readonly renderableBrief: Signal<WeeklyBrief | null> = computed(() => {
    const b = this.brief();
    return b && b.state !== 'empty' ? b : null;
  });

  // "Sources" chip row view-model — precomputed here rather than resolved per-chip in
  // the template (repo rule: docs/reviews/frontend-checklist.md §4). Empty when the
  // brief has no source_refs, which the template uses to skip rendering the row/header
  // entirely.
  public readonly sourceChips: Signal<WeeklyBriefSourceChip[]> = computed(() => mapWeeklyBriefSourceRefsToChips(this.renderableBrief()?.source_refs ?? []));

  // Raw source_refs count, duplicates included — NOT the deduped sourceChips() length. Drives
  // both the collapse threshold comparison and the "Sources (N)" disclosure header (LFXV2-3335).
  // `?? []` before `.length`, not `?.source_refs.length ?? 0`, matches the sourceChips computed
  // above's guard: a brief response missing source_refs must not throw through this computed.
  public readonly sourceRefCount: Signal<number> = computed(() => (this.renderableBrief()?.source_refs ?? []).length);

  // sourceChips() grouped into fixed-order kind-sections for the expanded disclosure view
  // (LFXV2-3335) — precomputed here rather than re-derived in the template (frontend-checklist
  // §4). See initSourceChipSections for the "Other" catch-all rationale.
  public readonly sourceChipSections: Signal<WeeklyBriefSourceChipSection[]> = this.initSourceChipSections();

  // Gates the "this week so far" activity tally (GH-1922) to Board/Government Advisory Council
  // committees only for v1 — named for exactly that (not the broader `isGovernanceClass`, which
  // also matches oversight-committee/TSC/Legal/Finance). `committee().category` is always
  // populated on this input (unlike `behavioralClass`, which is only decorated on the
  // dashboard's own data path, not this one), so this derives the classification directly
  // rather than reading a field that isn't there.
  public readonly isGoverningBoardCommittee: Signal<boolean> = computed(() => isGoverningBoard(this.committee().category));

  // Current, in-progress-week activity — a BFF enrichment on the response envelope (like
  // caller_rating), sourced server-side from CommitteeActivityService's existing live
  // meeting/vote/document aggregation (GH-1922), so it's populated identically in mock and live
  // mode. Read from briefResponse, not brief(): it's scoped to a different window than the
  // brief's own completed week, so it isn't part of WeeklyBrief itself.
  public readonly currentActivity: Signal<WeeklyBriefCurrentActivitySection[]> = this.initCurrentActivitySections();

  // Distinguishes "no value to show" (absent — either a transient server-side degrade, or this
  // card's own deliberate includeCurrentActivity: false opt-out — or null — a settled
  // non-governance answer; see WeeklyBriefCurrentResponse's own current_activity doc comment, in
  // @lfx-one/shared/interfaces, for that three-state contract, which pollUntilTerminal's poll
  // loop below depends on but rendering here doesn't) from "the field is a real object, every
  // kind possibly zero, possibly truncated: true" (a genuine quiet week, or a real-but-partial
  // tally) — the template must render neither line nor "no activity yet" for the former, only
  // the latter (GH-1922: "do NOT fabricate ... degrade gracefully").
  public readonly hasCurrentActivityData: Signal<boolean> = computed(() => !!this.briefResponse()?.current_activity);

  // Single source of truth for the visible prefix, shared with the template's own span
  // (weekly-brief-card.component.html) so the accessible name (currentActivityLine, below) and
  // the visible text can't drift apart on a future copy edit.
  protected readonly currentActivityPrefix = 'This week so far:';

  // GH-1998: current-week activity filled a full upstream page — source_refs is a floor, not the
  // total. Deliberately doesn't name a count: the truncation gate fires on the raw upstream page
  // size, before the window_end filter and kind-mapping this component's own tally is built from,
  // so a specific number here (e.g. "50+ events") could overstate what actually happened this
  // week. Two variants, not one static string: a page full of raw events that all get
  // filtered/unmapped away (see buildCurrentActivity's own doc comment) still carries
  // truncated: true with an empty tally, and pairing that with "This count may be incomplete"
  // would read as "no activity yet" when the truth is closer to "we don't actually know." Hiding
  // the note in that case instead (as an earlier version of this fix did) would be worse — a
  // false-complete "no activity yet" is exactly the outcome GH-1922 says to avoid; the fix is
  // to say the honest thing, not to say nothing. Starting-point copy, flagged for product
  // review, not locked in.
  protected readonly currentActivityTruncationNote: Signal<string> = computed(() =>
    this.currentActivity().length
      ? 'This count may be incomplete — view Recent Activity for the full list.'
      : 'Activity this week could not be fully counted — view Recent Activity for the full list.'
  );

  // The server's raw truncated flag — do not additionally gate this on currentActivity().length.
  // The template always shows *some* truncation note once this is true (see
  // currentActivityTruncationNote's two variants above); a reader reaching for isTruncated to ask
  // "is this data complete?" must get a truthful answer regardless of whether the surviving tally
  // happens to be empty.
  public readonly isTruncated: Signal<boolean> = computed(() => !!this.briefResponse()?.current_activity?.truncated);

  // GH-1998: the empty-tally placeholder itself, not just the separate truncation note below it,
  // must not assert "no activity yet" when isTruncated() is true — that's the same false-complete
  // claim this whole fix exists to avoid, just relocated to the tally line instead of the note.
  // Read by both the visible @else span and currentActivityLine (its aria-label) below, so the
  // two can't drift out of sync the way "no activity yet" vs. the note text did before this fix.
  protected readonly currentActivityEmptyText: Signal<string> = computed(() => (this.isTruncated() ? "activity couldn't be counted" : 'no activity yet'));

  // "This week so far: 1 meeting held, 1 vote closed" / "This week so far: no activity yet" /
  // "This week so far: activity couldn't be counted". The truncation note (GH-1998) is a separate
  // visible element (see the template), not folded in here — this stays the accessible name for
  // the tally group alone, so a screen reader doesn't hear the note announced twice (once for
  // this group, once for its own sibling paragraph).
  public readonly currentActivityLine: Signal<string> = computed(() => {
    const sections = this.currentActivity();
    return !sections.length
      ? `${this.currentActivityPrefix} ${this.currentActivityEmptyText()}`
      : `${this.currentActivityPrefix} ${sections.map((section) => section.countText).join(', ')}`;
  });

  // "no_sources" is the only error_reason meaningful to the UI today (LFXV2-3000) —
  // a committee with zero activity in the lookback window, not a genuine generation
  // failure. Retrying it can never succeed and would just spend a regeneration slot,
  // so this renders a calm empty state instead of the failure card's "Try again".
  public readonly isQuietWeek: Signal<boolean> = computed(() => {
    const b = this.brief();
    return b?.state === 'error' && b?.error_reason === WEEKLY_BRIEF_ERROR_REASON.NO_SOURCES;
  });

  // The caller's own rating on the brief currently on screen — the optimistic overlay
  // when it's for this exact revision, otherwise whatever the last server load reported.
  // `caller_rating` is BFF enrichment on the response envelope, not on `WeeklyBrief`
  // itself (there's no upstream field for it) — read from `briefResponse`, not `brief()`.
  public readonly callerRating: Signal<WeeklyBriefRating | null> = computed(() => {
    const b = this.brief();
    const override = this.optimisticRating();
    if (b && override && override.briefUid === b.uid && override.revision === b.revision) return override.value;
    return this.briefResponse()?.caller_rating ?? null;
  });

  // BFF enrichment on the response envelope (GH-1966), not on `WeeklyBrief` itself — read from
  // `briefResponse`, same pattern as `callerRating`. `null` whenever staleness couldn't be
  // computed (non-shareable state, mock mode, an unparseable timestamp, or an inconclusive or
  // soft-failed upstream fetch); a brief generated after its own window closed instead
  // confidently reports `stale: false`. Purely informational — never gates
  // canGenerate/canRegenerate.
  public readonly staleness: Signal<WeeklyBriefStaleness | null> = computed(() => this.briefResponse()?.staleness ?? null);

  // Precomputed here rather than resolved inline in the template (repo rule:
  // docs/reviews/frontend-checklist.md §4) — also avoids a nested ternary in markup.
  public readonly stalenessTooltip: Signal<string> = computed(() => {
    const s = this.staleness();
    if (!s) return '';
    const suffix = s.event_count_is_floor ? '+' : '';
    // `updated_at` (what staleness compares against) is the last edit time for an `edited`
    // brief, not its original generation time — "last updated" covers both without
    // misattributing an edit to a regenerate that never happened.
    const noun = s.event_count === 1 && !s.event_count_is_floor ? 'event' : 'events';
    return `${s.event_count}${suffix} new ${noun} since this brief was last updated`;
  });

  public readonly canGenerate: Signal<boolean> = computed(() => {
    const t = this.throttle();
    return !t || t.generates_used < t.generates_limit;
  });

  public readonly canRegenerate: Signal<boolean> = computed(() => {
    const t = this.throttle();
    return !t || t.regenerations_used < t.regenerations_limit;
  });

  public readonly weekLabel: Signal<string> = computed(() => {
    const b = this.brief();
    if (!b) return '';
    // window_start / window_end are UTC ISO boundaries (Sun 00:00Z → Sat 23:59Z).
    return formatUtcDateRangeLabel(b.window_start, b.window_end);
  });

  // Recipients actually resolve from committee membership (via the newsletter
  // send pipeline), not the Groups.io mailing list — the label must describe
  // the real audience, not the list address, or the confirm dialog would
  // promise a destination the send never uses.
  public readonly shareAudienceLabel: Signal<string> = computed(() => `all members of ${this.committee()?.name ?? 'this committee'}`);

  public constructor() {
    this.initBriefResponseSubscription();
  }

  // Public actions
  public onOpenArchive(): void {
    this.archiveVisible.set(true);
  }

  public onGenerate(): void {
    if (this.generating()) return;
    const committeeUid = this.committee()?.uid;
    if (!committeeUid) return;
    this.generating.set(true);
    this.pollTimedOut.set(false);
    // renderableBrief, not brief: a real brief object with state: 'empty' renders the
    // empty-state Generate button (gated on canGenerate/generates), but brief() alone is
    // truthy for it — sending force: true would spend a regeneration instead.
    const currentBrief = this.renderableBrief();
    // GenerateWeeklyBriefRequest only accepts `force` (LFXV2-2175 review: there is no
    // client-supplied revision — conflict detection is entirely server-side, via 409
    // edited_brief_exists). force: true is what both re-requests a brief that already
    // exists (Regenerate) and counts against the separate regenerations throttle.
    const body = currentBrief ? { force: true } : {};
    this.weeklyBriefService
      .generateWeeklyBrief(committeeUid, body)
      .pipe(
        // Bounds the pre-poll window: without this, a stalled POST leaves generating()
        // true and pollTimedOut() false indefinitely — the same dead end pollUntilTerminal
        // exists to close, just before the poll itself ever starts.
        timeout(WEEKLY_BRIEF_POLL_INTERVAL_MS * 2),
        take(1),
        // Angular's RouteReuseStrategy can keep this component alive across a committee
        // navigation (same rationale as pollUntilTerminal's identical guard below) — a
        // generate started on committee A whose response arrives after the user has
        // already navigated to committee B must not overwrite B's briefResponse with A's
        // stale data.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        // The component can be destroyed while this request is still in flight (click
        // Generate, then navigate away) — without this, `next` still runs against a
        // destroyed component: it writes to signals nothing reads anymore and starts a
        // poll (pollUntilTerminal) with nothing left to stop it early via destroy.
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        // Upstream's generate call is a 202 accepted, not a completed brief — the
        // actual generation runs out-of-band. Render the 202 body's `generating` state
        // immediately (it's already in hand — no reason to wait a full poll interval
        // and risk reading back the still-terminal pre-generate brief instead), then
        // poll GET /current until it lands on a terminal state.
        next: (res) => {
          // Upstream marks nothing Required on the 202 envelope — a bare 202 with no
          // brief/throttle must not wipe what's already rendered (most visible on
          // Regenerate, where a real brief is on screen when this fires). Same reasoning
          // extends to current_activity (GH-1922): this week's activity doesn't change just
          // because a brief was requested, so it always carries forward regardless of whether
          // res.brief itself landed. caller_rating and staleness (GH-1966) are both narrower:
          // each describes specific brief content, so both only carry forward when res.brief is
          // absent. Upstream's own contract documents brief as normally populated on this
          // response (the new, just-created `state: 'generating'` revision, per
          // GroupWeeklyBriefGenerateResult's description and its 202 example) — reusing the
          // pre-regenerate rating or staleness verdict against that new revision would
          // misattribute (staleness in particular is computed against the OLD brief's
          // `updated_at`, which a new revision replaces), so both drop whenever res.brief lands
          // and let the poll's first GET restore the correct values for that revision instead.
          // Spreads `prev` rather than enumerating every field, so a week-scoped field like
          // current_activity (unaffected by a brief request) carries forward by construction
          // instead of needing to be named here. This is NOT a universal safety improvement,
          // though: a brief-scoped field — keyed to the specific brief/revision, like
          // caller_rating/staleness below — is wrong to carry forward once res.brief lands, and
          // spreading would silently do exactly that unless explicitly overridden. A future field
          // must be classified as one or the other, not assumed safe by default either way.
          this.briefResponse.update((prev) => ({
            ...prev,
            brief: res.brief ?? prev?.brief ?? null,
            throttle: res.throttle ?? prev?.throttle ?? null,
            caller_rating: res.brief ? null : prev?.caller_rating,
            staleness: res.brief ? undefined : prev?.staleness,
          }));
          // On Regenerate, currentBrief.revision is the pre-regenerate revision — pollUntilTerminal
          // uses it to reject a first tick that reads back that same (stale) terminal brief instead
          // of the new one still being written. undefined on a fresh generate (no prior revision to
          // compare against).
          this.pollUntilTerminal(committeeUid, currentBrief?.revision);
        },
        error: (err: HttpErrorResponse | TimeoutError) => {
          if (err instanceof TimeoutError) {
            // The POST itself timed out, but upstream may well have accepted it (202,
            // quota consumed, generation running) — fall into the same poll that handles
            // a normal 202, rather than toasting an error and leaving the card able to
            // spend a second generate/regenerate on what might already be in progress.
            // The poll's own attempt cap (pollTimedOut) bounds this if nothing comes back.
            this.pollUntilTerminal(committeeUid, currentBrief?.revision);
            return;
          }
          this.generating.set(false);
          let detail: string;
          switch (err?.status) {
            case 429:
              detail = currentBrief ? 'Weekly regeneration limit reached. Try again next week.' : 'Weekly generation limit reached. Try again next week.';
              // Without this, a stale client-side throttle count can leave canGenerate/
              // canRegenerate enabled after a quota-exhausted response, letting the user
              // re-trigger the same 429 on every click — matches the 409 branch below.
              this.refresh$.next();
              break;
            case 409:
              // Upstream's edited-brief guard: someone else edited the brief
              // for this window. Prompt reload — the user can decide whether
              // to force-regenerate from the refreshed copy.
              detail = 'Someone else edited this brief. Reload to see the latest version before regenerating.';
              this.refresh$.next();
              break;
            default:
              detail = 'Failed to generate brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Generate failed', detail });
        },
      });
  }

  public onEdit(): void {
    this.editMode.set(true);
    this.editForm.controls.briefText.setValue(this.brief()?.brief_text ?? '');
  }

  public onSave(): void {
    const committeeUid = this.committee()?.uid;
    const current = this.brief();
    if (!committeeUid || !current) return;
    const text = this.editForm.controls.briefText.value.trim();
    if (!text) {
      this.messageService.add({ severity: 'warn', summary: 'Empty brief', detail: 'Brief text cannot be empty.' });
      return;
    }
    this.saving.set(true);
    this.weeklyBriefService
      .saveWeeklyBrief(committeeUid, { brief_text: text, revision: current.revision })
      .pipe(
        take(1),
        // Same guard as onGenerate's POST pipe: a save started on committee A whose response
        // arrives after the user has already navigated to committee B must not clear B's
        // saving/editMode or trigger an unwanted refresh$ on B's card (dealako review, round 3).
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editMode.set(false);
          this.refresh$.next();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          let detail: string;
          if (err?.status === 409) {
            detail = 'Someone else updated this brief. Reloaded the latest version — your edit was not saved.';
            // Matches onGenerate's 409 branch: without this, the user is stuck holding a
            // stale revision in edit mode, and every retry re-409s until a full page reload.
            this.editMode.set(false);
            this.refresh$.next();
          } else {
            detail = 'Failed to save brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Save failed', detail });
        },
      });
  }

  public onShareToMailingList(): void {
    // The Share action only renders outside edit mode (see the template's
    // @if (editMode()) branch), so there is never an unsaved-edit case to
    // guard here — the brief is always whatever was last saved.
    //
    // Captured here, not re-read in performShare at accept-time: the dialog's message
    // names a specific committee/audience, so the request that follows Send must target
    // that same snapshot — not whatever committee()/brief() happen to be current if the
    // signals changed while the dialog was open (component reuse across a committee
    // navigation, or a background poll landing mid-dialog).
    const committeeUid = this.committee()?.uid;
    const revision = this.brief()?.revision;
    if (!committeeUid || revision === undefined) return;
    this.confirmationService.confirm({
      header: 'Share to Mailing List',
      message: `Send the current brief by email to ${this.shareAudienceLabel()}?`,
      icon: 'fa-light fa-paper-plane',
      acceptLabel: 'Send',
      rejectLabel: 'Cancel',
      accept: () => this.performShare(committeeUid, revision),
    });
  }

  public onShareToSlack(): void {
    // Same snapshot-not-re-read rationale as onShareToMailingList: the confirmation dialog
    // names a specific committee, so the request that follows must target that same snapshot.
    const committeeUid = this.committee()?.uid;
    const revision = this.brief()?.revision;
    if (!committeeUid || revision === undefined) return;
    this.confirmationService.confirm({
      header: 'Share to Slack',
      message: 'Send the current brief to this committee’s Slack channel?',
      icon: 'fa-brands fa-slack',
      acceptLabel: 'Send',
      rejectLabel: 'Cancel',
      accept: () => this.performShareToSlack(committeeUid, revision),
    });
  }

  public async onCopyAndShare(): Promise<void> {
    const text = this.brief()?.brief_text ?? '';
    // Matches planning-tab.component.ts's copyToClipboard guard: navigator.clipboard is
    // unavailable during SSR and on some browsers/contexts (non-HTTPS, older Safari).
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy not supported',
        detail: 'Clipboard access is unavailable in this browser.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'Brief copied — paste into your mailing list or Slack',
      });
    } catch {
      console.warn('[weekly-brief-card] clipboard write failed');
      this.messageService.add({
        severity: 'error',
        summary: 'Copy failed',
        detail: 'Could not access clipboard.',
      });
    }
  }

  // Tapping the currently-active thumb clears the rating; tapping the other one switches.
  // Optimistic: the overlay is set before the request fires and rolled back on failure —
  // this is a one-tap, low-stakes action, so waiting on a round-trip before showing
  // feedback isn't worth the click feeling unresponsive.
  public onRate(value: WeeklyBriefRating): void {
    const committeeUid = this.committee()?.uid;
    const current = this.brief();
    if (!committeeUid || !current || this.ratingPending() || this.impersonating()) return;
    const previous = this.callerRating();
    const next = previous === value ? null : value;
    this.optimisticRating.set({ briefUid: current.uid, revision: current.revision, value: next });
    this.ratingPending.set(true);
    // Explicit `Observable<unknown>` — without it, the ternary's two branches (`Observable<void>`
    // vs `Observable<RateWeeklyBriefResponse>`) infer a union type whose `.pipe()` overload
    // resolution TypeScript can't cleanly unify, breaking the `.subscribe()` call below.
    const request$: Observable<unknown> =
      next === null
        ? this.weeklyBriefService.clearWeeklyBriefRating(committeeUid, current.uid, current.revision)
        : this.weeklyBriefService.rateWeeklyBrief(committeeUid, current.uid, next, current.revision);
    request$
      .pipe(
        take(1),
        // Same guard as onSave/performShare: a rate/clear started on committee A whose
        // response arrives after the user has already navigated to committee B must not
        // touch B's rating state.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.ratingPending.set(false))
      )
      .subscribe({
        error: (err: HttpErrorResponse) => {
          this.optimisticRating.set({ briefUid: current.uid, revision: current.revision, value: previous });
          // The server 404s when briefUid no longer names the committee's current brief (a
          // window rollover) or the brief moved out of a ratable state (a co-chair regenerated
          // in another tab), and 409s when the revision this card rendered no longer matches the
          // server-resolved current revision (a co-chair's edit/regenerate landed between page
          // load and this tap) — see resolveRatableBrief. Retrying against the same stale card can
          // never succeed either way; refresh$ pulls the real current state instead of leaving the
          // user stuck tapping a button that will keep failing (same dead-end onSave's 409 branch
          // and onGenerate's 409 branch already close).
          if (err?.status === 404 || err?.status === 409) {
            this.refresh$.next();
            this.messageService.add({
              severity: 'error',
              summary: 'Rating failed',
              detail: 'This brief has changed. Reloaded the latest version — please rate again.',
            });
            return;
          }
          this.messageService.add({ severity: 'error', summary: 'Rating failed', detail: 'Failed to save your rating. Please try again.' });
        },
      });
  }

  public onCancelEdit(): void {
    this.editMode.set(false);
  }

  public onRetry(): void {
    this.refresh$.next();
  }

  // Mirrors committee-overview.component.ts's handleActivityItemClick for these same action
  // kinds — 'past-meeting' navigates directly (no drawer for this action), 'vote-drawer' and
  // 'tab' bubble up via voteDrawerRequested/tabNavigated for the parent to drive its own
  // drawer/tab state, same as that component's own openVoteDrawer/navigateToTab.
  public onSourceChipAction(action: WeeklyBriefSourceChipAction): void {
    switch (action.kind) {
      case 'past-meeting':
        void this.router.navigate(['/meetings', action.meetingId], action.password ? { queryParams: { password: action.password } } : {});
        break;
      case 'vote-drawer':
        this.voteDrawerRequested.emit(action.voteUid);
        break;
      case 'tab':
        this.tabNavigated.emit(action.tab);
        break;
    }
  }

  // Level-1 Sources row disclosure (LFXV2-3335).
  public onToggleSources(): void {
    this.sourcesExpanded.update((expanded) => !expanded);
  }

  // Level-2 per-group disclosure, keyed by the group chip's id (LFXV2-3335). Copies into a
  // new Set rather than mutating in place so the signal's change detection fires.
  public onToggleSourceGroup(chipId: string): void {
    this.expandedSourceGroups.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(chipId)) {
        next.delete(chipId);
      } else {
        next.add(chipId);
      }
      return next;
    });
  }

  // Level-1/only disclosure for the "this week so far" tally, keyed by kind (GH-1922) — same
  // shape as onToggleSourceGroup.
  public onToggleActivityKind(kind: string): void {
    this.expandedActivityKinds.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  }

  // Private initializer functions
  // Groups sourceChips() into the fixed-order kind-sections defined by WEEKLY_BRIEF_SOURCE_SECTIONS
  // (LFXV2-3335), appending a trailing "Other" section for any chip whose kind isn't one of the
  // known ones — kind is an open string (see WeeklyBriefSourceRef's doc comment), so without this
  // catch-all an unrecognized future kind would silently vanish from the expanded view while
  // still counted in sourceRefCount(), contradicting mapWeeklyBriefSourceRefsToChips's "renders
  // unlinked instead of breaking" contract. A section with no chips is omitted entirely.
  private initSourceChipSections(): Signal<WeeklyBriefSourceChipSection[]> {
    return computed(() => {
      const chips = this.sourceChips();
      const known = new Set(WEEKLY_BRIEF_SOURCE_SECTIONS.map((section) => section.kind));
      const sections = WEEKLY_BRIEF_SOURCE_SECTIONS.map(({ kind, label }) => ({ kind, label, chips: chips.filter((chip) => chip.kind === kind) }));
      sections.push({ kind: 'other', label: 'Other', chips: chips.filter((chip) => !known.has(chip.kind)) });
      return sections.filter((section) => section.chips.length > 0);
    });
  }

  // Groups current_activity.source_refs into fixed-order kind-sections. Section MEMBERSHIP (which
  // kinds exist, and in what order) is driven by WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES alone — NOT
  // by cross-referencing WEEKLY_BRIEF_SOURCE_SECTIONS by kind, since that could silently produce a
  // countText-less section for a kind present in one list but not the other (PHRASES is the sole
  // source of truth for which kinds the tally recognizes; see its doc comment). The section's
  // display LABEL, in contrast, is looked up from WEEKLY_BRIEF_SOURCE_SECTIONS below — reusing the
  // Sources row's existing label strings rather than duplicating them in PHRASES too — with a
  // `?? kind` fallback that's what actually prevents a blank label if the two lists ever diverge on
  // a kind's presence. Any ref whose kind ISN'T recognized by PHRASES rolls into a trailing "N
  // other updates" bucket, mirroring initSourceChipSections's "Other" catch-all — without it, a
  // week whose only activity is an unrecognized kind would render the misleading "no activity yet"
  // line instead of admitting the tally just can't name it.
  private initCurrentActivitySections(): Signal<WeeklyBriefCurrentActivitySection[]> {
    return computed(() => {
      const refs = this.briefResponse()?.current_activity?.source_refs ?? [];
      const known = new Set(WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES.map((phrase) => phrase.kind));
      const sections = WEEKLY_BRIEF_CURRENT_ACTIVITY_PHRASES.map(({ kind, singular, plural }) => {
        const kindRefs = refs.filter((ref) => ref.kind === kind);
        const label = WEEKLY_BRIEF_SOURCE_SECTIONS.find((section) => section.kind === kind)?.label ?? kind;
        return { kind, label, refs: kindRefs, countText: `${kindRefs.length} ${kindRefs.length === 1 ? singular : plural}` };
      });
      const otherRefs = refs.filter((ref) => !known.has(ref.kind));
      if (otherRefs.length > 0) {
        sections.push({ kind: 'other', label: 'Other', refs: otherRefs, countText: `${otherRefs.length} other update${otherRefs.length === 1 ? '' : 's'}` });
      }
      return sections.filter((section) => section.refs.length > 0);
    });
  }

  private initBriefResponseSubscription(): void {
    const committeeUid$ = this.committee$.pipe(
      filter((c): c is Committee => !!c?.uid),
      map((c) => c.uid),
      // A refresh (e.g. joining/leaving, a description save) re-emits a new Committee
      // object with the same uid — skip the redundant brief round-trip when the id
      // itself hasn't changed (matches committee-view.component.ts's initUpcomingMeetings).
      distinctUntilChanged()
    );
    // Committee reuse (RouteReuseStrategy) means this instance survives a navigation
    // between committees — without an explicit reset, a stale `editMode`/`editForm`
    // (edited text from the previous committee, rendered against the new committee's
    // brief), a leftover `generating` flag from a generate call cut off mid-flight (see
    // the takeUntil guard in onGenerate), a leftover `saving` flag from a save cut off
    // mid-flight (see the same guard in onSave), or a leftover `sharing` flag from a
    // share cut off mid-flight (see the same guard in performShare) would bleed onto
    // the new committee's card.
    committeeUid$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.generating.set(false);
      this.saving.set(false);
      this.sharing.set(false);
      this.sharingSlack.set(false);
      this.editMode.set(false);
      this.editForm.reset({ briefText: '' });
      this.ratingPending.set(false);
      this.optimisticRating.set(null);
      // Reset archive state when navigating between committees.
      this.hasArchiveBriefs.set(false);
      this.archiveVisible.set(false);
      // Reset Sources disclosure state (LFXV2-3335) — a stale expanded row/group from the
      // previous committee must not bleed onto the new one, same rationale as every other
      // reset in this block.
      this.sourcesExpanded.set(false);
      this.expandedSourceGroups.set(new Set());
      // Reset "this week so far" disclosure state (GH-1922) — same rationale.
      this.expandedActivityKinds.set(new Set());
    });

    // Archive preflight — fires once per committee as soon as the uid is known,
    // independently of the current brief. A limit=1 fetch confirms at least one past
    // shareable brief exists before the "Past Briefs" button is shown.
    committeeUid$
      .pipe(
        switchMap((uid) =>
          this.weeklyBriefService.listWeeklyBriefs(uid, { limit: 1 }).pipe(catchError(() => of(null as PaginatedResponse<WeeklyBrief> | null)))
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        const shareable = (response?.data ?? []).filter((b) => WEEKLY_BRIEF_SHAREABLE_STATES.includes(b.state));
        this.hasArchiveBriefs.set(shareable.length > 0);
      });
    combineLatest([committeeUid$, this.refresh$])
      .pipe(
        switchMap(([uid]) => {
          this.fetchLoading.set(true);
          this.fetchError.set(false);
          this.pollTimedOut.set(false);
          // includeCurrentActivity: this.isGoverningBoardCommittee() (GH-1922) — the template
          // already gates the whole tally section on isGoverningBoardCommittee() independently
          // of current_activity's presence (see the template's top-level @if), so for the
          // majority of committees that aren't governance-classified, skipping the server's
          // fan-out here costs nothing in the UI — the section wouldn't render either way — and
          // saves a wasted upstream GET on every non-governance committee's card load.
          return this.weeklyBriefService.getWeeklyBrief(uid, { includeCurrentActivity: this.isGoverningBoardCommittee() }).pipe(
            catchError((err: unknown) => {
              // A failed read (e.g. upstream 503) must not look like "no brief
              // yet" — flag it so the template can show a distinct, retryable
              // unavailable state instead of the empty-state Generate prompt.
              console.error('[weekly-brief-card] failed to load current brief', err);
              this.fetchError.set(true);
              return of(null as WeeklyBriefCurrentResponse | null);
            }),
            finalize(() => this.fetchLoading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        this.briefResponse.set(response);
        // A fresh, authoritative GET always supersedes any optimistic rating overlay —
        // otherwise a silent server-side persist failure (rateBrief/clearBriefRating
        // return 200 while their Valkey write no-ops) would leave a stale thumb lit even
        // across a manual refresh. `callerRating`'s brief-uid+revision key already makes
        // the overlay self-invalidate on a genuinely different brief/revision; this covers
        // the same-revision case too.
        this.optimisticRating.set(null);
        // Covers a page reload, navigating back to this committee, or a co-chair's
        // generation already in flight — not just this tab's own onGenerate() call.
        // Without this, a card that *loads* into the generating state never polls and
        // is stuck on the spinner with no way to reach a terminal state. (SSR: this can fire
        // during a server render too — pollUntilTerminal itself is the isPlatformBrowser choke
        // point, not this call site; see its docstring. The template still renders the
        // generating state correctly here from `brief()?.state` alone.)
        const uid = this.committee()?.uid;
        if (uid && response?.brief?.state === 'generating') {
          this.pollUntilTerminal(uid);
        }
      });
  }

  // Polls GET /current after a generate/regenerate call is accepted (202) — or after a
  // load lands on an already-in-progress generation — until the brief reaches a
  // terminal state (generated/edited/approved/error), or the attempt cap trips. A
  // transient poll failure doesn't abandon the poll — only the cap does.
  //
  // priorRevision (Regenerate only): rejects a terminal-looking tick whose revision still
  // matches the pre-regenerate brief — if the first GET lands before upstream's write is
  // visible, it can read back the still-terminal *previous* brief and this poll would
  // otherwise treat that as "done," silently completing while the real regeneration is
  // still running and the quota has already been spent.
  private pollUntilTerminal(committeeUid: string, priorRevision?: number): void {
    // Defense-in-depth alongside the isPlatformBrowser guard on this method's load-time
    // caller: zoneless change detection doesn't block SSR stability on a bare timer() the way
    // it does HttpClient calls, so this is the single choke point that must never start the
    // poll loop server-side, regardless of which call site reaches it (dealako review, round 3).
    if (!isPlatformBrowser(this.platformId) || this.pollActive) return;
    this.pollActive = true;
    this.generating.set(true);
    this.pollTimedOut.set(false);
    let ticks = 0;
    let observedTerminal = false;
    // Bounds how many ticks keep re-asking for current_activity while it stays undefined — see
    // WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS's own doc comment for why this needs its
    // own, smaller cap than the poll's overall WEEKLY_BRIEF_MAX_POLL_ATTEMPTS.
    let currentActivityAskAttempts = 0;
    const isNewTerminal = (response: WeeklyBriefCurrentResponse): boolean => {
      const b = response.brief;
      if (!b || !WEEKLY_BRIEF_TERMINAL_STATES.has(b.state)) return false;
      // 'error' is always a fresh, unambiguous signal — trust it immediately regardless of
      // revision, unlike generated/edited/approved, which a stale read could report on the
      // pre-regenerate brief without actually bumping revision.
      if (b.state === 'error') return true;
      return priorRevision === undefined || b.revision !== priorRevision;
    };
    timer(WEEKLY_BRIEF_POLL_INTERVAL_MS, WEEKLY_BRIEF_POLL_INTERVAL_MS)
      .pipe(
        take(WEEKLY_BRIEF_MAX_POLL_ATTEMPTS),
        tap(() => {
          ticks += 1;
        }),
        // exhaustMap, not switchMap: a GET that outlives one interval tick must not be
        // cancelled and restarted on the next tick — that would mean no request ever
        // resolves and the poll dies silently once the attempt cap is hit. Skip a tick
        // instead if the previous one is still in flight. A per-tick timeout bounds the
        // exhaustMap wait itself — otherwise a single hung request would block `complete`
        // (and the attempt cap) indefinitely, since exhaustMap only completes once its
        // last active inner subscription settles.
        exhaustMap(() => {
          // includeCurrentActivity (GH-1922): only opt out once the current_activity KEY is
          // actually present on the response — `=== undefined` here, not a falsy/truthy check,
          // because the BFF distinguishes "couldn't determine yet" (key absent — transient,
          // worth asking again) from "known, settled, doesn't apply" (key present as `null` —
          // non-governance only; see WeeklyBriefCurrentResponse.current_activity's doc comment).
          // A `!value` check would treat that settled `null` the same as "unknown" and re-ask
          // forever for a case that can't resolve differently within this poll cycle.
          //
          // Also gated on isGoverningBoardCommittee() — a non-governance committee's every
          // non-poll load (see initBriefResponseSubscription's own combineLatest sources for
          // what triggers one) deliberately opts out too, which leaves current_activity
          // absent (not the settled null a fan-out call would have produced). Without this extra
          // gate, that deliberate client-side opt-out would look exactly like a transient degrade
          // and cost one wasted ask on the first poll tick, before the server's own settled null
          // ever had a chance to stop it — undoing part of that opt-out's savings in the one code
          // path (a generating card) it runs in.
          //
          // Also capped at WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS, separately from the
          // undefined check above — an upstream that keeps failing this specific fan-out (not
          // the brief generation itself) would otherwise get asked again on every one of up to
          // WEEKLY_BRIEF_MAX_POLL_ATTEMPTS ticks for an answer that keeps failing the same way.
          // Only increment on a tick that actually asks — a tick that already opted out (settled
          // null/present, not governance, or the cap already hit) must not keep advancing the
          // counter past the cap.
          const shouldAskCurrentActivity =
            this.isGoverningBoardCommittee() &&
            this.briefResponse()?.current_activity === undefined &&
            currentActivityAskAttempts < WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS;
          if (shouldAskCurrentActivity) currentActivityAskAttempts += 1;
          return this.weeklyBriefService.getWeeklyBrief(committeeUid, { includeCurrentActivity: shouldAskCurrentActivity }).pipe(
            timeout(WEEKLY_BRIEF_POLL_INTERVAL_MS),
            catchError((err: unknown) => {
              console.error('[weekly-brief-card] poll tick failed, will retry', err);
              // Undo the optimistic increment above ONLY for a transport-level failure — the
              // request never reached, or never got a response from, the BFF at all
              // (HttpErrorResponse.status === 0: connection refused, DNS failure, CORS block,
              // etc.). Neither of the other two error shapes qualifies: this tick's own
              // `timeout(WEEKLY_BRIEF_POLL_INTERVAL_MS)` above (TimeoutError) doesn't cancel the
              // server-side work already in flight, and a real HTTP error response (4xx/5xx,
              // status !== 0) means the BFF DID receive and process the request — it just failed
              // to answer well. Refunding for either would let a persistently slow OR persistently
              // erroring (not just erroring) upstream — the exact case
              // WEEKLY_BRIEF_CURRENT_ACTIVITY_MAX_ASK_ATTEMPTS exists to bound — re-ask on every
              // one of up to WEEKLY_BRIEF_MAX_POLL_ATTEMPTS ticks instead of stopping at the cap.
              const isTransportFailure = err instanceof HttpErrorResponse && err.status === 0;
              if (shouldAskCurrentActivity && isTransportFailure) currentActivityAskAttempts -= 1;
              return of(null as WeeklyBriefCurrentResponse | null);
            })
          );
        }),
        // Drop failed ticks entirely rather than feeding `null` into takeWhile below —
        // a transient poll failure must not look like a terminal state and stop the poll.
        filter((response): response is WeeklyBriefCurrentResponse => response !== null),
        tap((response) => {
          // A tick that opted out (see above) carries no current_activity key of its own — fall
          // back to whatever the card already has rather than letting a plain .set() blank a
          // good value out just because this particular tick didn't ask for a fresh one.
          // `!== undefined`, not `??`: a tick that DID ask can come back with a settled `null`
          // (see the exhaustMap above), which must overwrite a stale prior `undefined` — `??`
          // would treat that fresh `null` as nullish too and wrongly keep falling back to prev.
          this.briefResponse.update((prev) => ({
            ...response,
            current_activity: response.current_activity !== undefined ? response.current_activity : prev?.current_activity,
          }));
          // Same reasoning as initBriefResponseSubscription's subscribe: a fresh GET
          // supersedes any optimistic overlay.
          this.optimisticRating.set(null);
          if (isNewTerminal(response)) {
            observedTerminal = true;
          }
        }),
        // Keep polling on anything that ISN'T a genuinely new terminal state — not just
        // 'generating'. A null brief or state: 'empty' on an early tick means the write isn't
        // visible yet, not that generation is done; treating either as terminal here would stop
        // the poll mid-generation and drop the card to "No brief yet" with the quota already
        // spent. Same for a terminal-looking tick whose revision still matches priorRevision —
        // see isNewTerminal.
        takeWhile((response) => !isNewTerminal(response), true),
        // refresh$ is also reachable while a poll is in flight (onRetry, the 409 branch
        // of onGenerate) — stop polling on a manual refresh so a late poll tick can't
        // overwrite a fresher refresh result. skip(1): refresh$ is a BehaviorSubject and
        // replays its current value on subscribe; only a genuinely new emission should cancel.
        takeUntil(this.refresh$.pipe(skip(1))),
        // Angular's default RouteReuseStrategy can keep this component alive across a
        // committee navigation (committee-view.component.ts only flips its own loading
        // state when there was no prior committee) — stop polling for a uid that's no
        // longer the one on screen, or a late tick would paint the old committee's brief
        // onto the new one's card.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef),
        // finalize, not just the complete callback below: an error escaping this pipe
        // (e.g. a throw inside the tap/takeWhile predicates above, outside exhaustMap's
        // own catchError) must still release pollActive and clear generating — otherwise
        // it's stuck true for the rest of the component's lifetime with no way to
        // restart polling, the same dead end this method exists to close.
        finalize(() => {
          this.pollActive = false;
          this.generating.set(false);
        })
      )
      .subscribe({
        complete: () => {
          // Only warn when the attempt cap was actually exhausted without ever observing
          // a terminal state — not when the poll stopped because of a manual refresh/409
          // (a fresher read is already on its way) or because the component was destroyed.
          if (!observedTerminal && ticks >= WEEKLY_BRIEF_MAX_POLL_ATTEMPTS) {
            // The generating branch renders on brief()?.state === 'generating' too, so
            // without this flag it would be a dead end with no way out but a page reload.
            this.pollTimedOut.set(true);
            this.messageService.add({
              severity: 'warn',
              summary: 'Still generating',
              detail: 'This is taking longer than expected — check back in a bit, or refresh.',
            });
          }
        },
      });
  }

  // Other private helpers
  private performShare(committeeUid: string, revision: number): void {
    this.sharing.set(true);
    this.weeklyBriefService
      .shareWeeklyBrief(committeeUid, revision)
      .pipe(
        take(1),
        // Same guard as onGenerate/onSave: a share started on committee A whose response
        // arrives after the user has already navigated to committee B must not clear B's
        // sharing flag or trigger an unwanted refresh$ on B's card (dealako review).
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sharing.set(false))
      )
      .subscribe({
        next: (result: ShareWeeklyBriefResult) => {
          if (result.total_recipients === 0) {
            this.messageService.add({
              severity: 'warn',
              summary: 'No recipients',
              detail: 'No recipients were found for this committee — nothing was sent.',
            });
            return;
          }
          this.messageService.add({
            severity: 'success',
            summary: 'Queued',
            detail: `Brief queued for delivery to ${result.total_recipients} recipient${result.total_recipients === 1 ? '' : 's'}.`,
          });
        },
        error: (err: HttpErrorResponse) => {
          const code = (err?.error as { code?: string } | undefined)?.code;
          const status = err?.status;
          let detail: string;
          if (status === 404) {
            detail = 'No brief available to share.';
          } else if (status === 403) {
            detail = 'Only project writers can share the weekly brief by email. Contact a project administrator.';
          } else if (status === 409) {
            if (code === 'NO_MAILING_LIST') {
              detail = 'No mailing list configured for this committee.';
            } else if (code === 'BACKEND_NOT_LIVE') {
              detail = 'Sharing is not available in this environment yet.';
            } else if (code === 'REVISION_MISMATCH') {
              detail = 'This brief was updated since you last viewed it. Reload to review the latest version before sharing.';
              this.refresh$.next();
            } else {
              detail = 'This brief is already being sent, or was already sent.';
            }
          } else if (status === 400) {
            // ServiceValidationError's top-level `error` field is a generic
            // "Validation failed for X" — the actionable text lives in the
            // per-field `errors[]` array.
            const fieldErrors = (err?.error as { errors?: ValidationError[] } | undefined)?.errors;
            detail = fieldErrors?.[0]?.message ?? 'Failed to share brief. Please try again.';
          } else if (status === 0 || status === 408 || status >= 500) {
            // The send is async — a dropped connection, timeout, or 5xx here
            // may mean the newsletter was already accepted upstream before
            // the failure reached the client. Don't invite a retry that
            // could send the brief twice. (status === 0 covers network
            // failures/aborts, which never surface an HTTP status.)
            detail = 'The send may not have completed — check the project’s Newsletters list before trying again.';
          } else {
            detail = 'Failed to share brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Share failed', detail });
        },
      });
  }

  private performShareToSlack(committeeUid: string, revision: number): void {
    this.sharingSlack.set(true);
    this.weeklyBriefService
      .shareWeeklyBriefToSlack(committeeUid, revision)
      .pipe(
        take(1),
        // Same guard as performShare: a send started on committee A whose response arrives
        // after the user has already navigated to committee B must not touch B's card.
        takeUntil(this.committee$.pipe(filter((c) => c?.uid !== committeeUid))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sharingSlack.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({ severity: 'success', summary: 'Sent', detail: 'Brief sent to the committee Slack channel.' });
        },
        error: (err: HttpErrorResponse) => {
          const code = (err?.error as { code?: string } | undefined)?.code;
          const status = err?.status;
          let detail: string;
          if (status === 404) {
            detail = 'No brief available to share.';
          } else if (status === 403) {
            // IMPERSONATION_READ_ONLY (weekly-brief.route.ts's blockDuringImpersonation) is also
            // a 403 — the button is already disabled during impersonation (see impersonating()),
            // so this branch is mostly a defense-in-depth backstop, but it must not claim the
            // impersonating caller lacks writer access, which is usually false.
            detail =
              code === 'IMPERSONATION_READ_ONLY'
                ? 'Sharing to Slack is unavailable while impersonating another user.'
                : 'Only project writers can share the weekly brief to Slack. Contact a project administrator.';
          } else if (status === 409) {
            if (code === 'NO_SLACK_WEBHOOK') {
              detail = 'No Slack webhook configured for this committee.';
            } else if (code === 'BACKEND_NOT_LIVE') {
              detail = 'Sharing is not available in this environment yet.';
            } else if (code === 'FEATURE_DISABLED') {
              // weekly-brief.service.ts's ServerFeatureFlag.WeeklyBriefSlack kill switch — only
              // reachable when it's off while the UI-facing wg-weekly-brief-slack flag is on
              // (both must be on for a real send). Not "reload and try again": reloading can't
              // fix this, only flipping the server flag can.
              detail = 'Sharing to Slack is not enabled in this environment yet.';
            } else if (code === 'REVISION_MISMATCH') {
              detail = 'This brief was updated since you last viewed it. Reload to review the latest version before sharing.';
              this.refresh$.next();
            } else {
              // Unlike performShare's mailing-list fallback, shareToSlack has no "already sent"
              // concept — it emits only the four codes above, so this branch is unreachable in
              // practice today. Kept neutral (not copy-pasted from performShare) in case a future
              // 409 code is added here without updating this switch.
              detail = "This brief can't be shared to Slack right now. Reload and try again.";
            }
          } else if (status === 400) {
            const fieldErrors = (err?.error as { errors?: ValidationError[] } | undefined)?.errors;
            detail = fieldErrors?.[0]?.message ?? 'Failed to share brief. Please try again.';
          } else if (status === 0 || status === 408 || status >= 500) {
            // committee-service now owns composing and sending the Slack message itself
            // (LFXV2-3094 / lfx-v2-committee-service PR #178) — this BFF no longer talks to Slack
            // directly, so there's no BFF-side SLACK_UNREACHABLE/SLACK_SEND_FAILED distinction to
            // make any more. A 5xx (or a dropped/timed-out connection to our own BFF) here is
            // ambiguous either way: there's no confirmation the message wasn't already sent before
            // the failure, same rationale as performShare's identical status-range branch.
            detail = 'The send may not have completed — check the Slack channel before trying again.';
          } else {
            detail = 'Failed to share brief. Please try again.';
          }
          this.messageService.add({ severity: 'error', summary: 'Share failed', detail });
        },
      });
  }
}
