// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, skip, switchMap, tap } from 'rxjs';

import { AUDIENCE_SIGNAL_INFO, AUDIENCE_SIGNAL_ORDER, AUDIENCE_UNION_EXACT_CAP } from '@lfx-one/shared/constants';
import type {
  AudienceBuilderCapabilities,
  AudienceCardBucket,
  AudienceComposeMasterPartial,
  AudienceComposeMasterResult,
  AudienceDiscoveredEvent,
  AudienceDiscoveredList,
  AudienceDiscoveryProgress,
  AudienceDiscoveryResult,
  AudienceDiscoverySSEEventType,
  AudienceLastSentEmail,
  AudienceListBrief,
  AudienceListSearchResult,
  AudienceMasterListBrief,
  AudiencePreviewCount,
  AudienceSignal,
  AudienceSuppressionList,
  SSEEvent,
} from '@lfx-one/shared/interfaces';

import { AudienceCardGridComponent } from '../audience-card-grid/audience-card-grid.component';
import { AudienceLastSentComponent } from '../audience-last-sent/audience-last-sent.component';
import { AudienceMissingSignalsComponent } from '../audience-missing-signals/audience-missing-signals.component';
import { AudienceQaPanelComponent } from '../audience-qa-panel/audience-qa-panel.component';
import { AudienceSuppressionGridComponent } from '../audience-suppression-grid/audience-suppression-grid.component';

/**
 * The Audience tab: discover candidate HubSpot lists for an event, review and select them, apply
 * suppression, preview the union, compose a master list, and QA the result.
 *
 * Selection state lives here rather than in the children because the same set of ids drives both
 * the preview count and the compose request — splitting it across the grids would mean keeping two
 * copies in step. The children are presentational: they take `input()`s and emit `output()`s.
 *
 * The panel stays mounted while other Email tabs are shown, so none of this state is loaded in a
 * lifecycle hook: capabilities load on first activation, and everything else is user-initiated.
 */
@Component({
  selector: 'lfx-audience-builder-tab',
  imports: [
    ReactiveFormsModule,
    AudienceCardGridComponent,
    AudienceSuppressionGridComponent,
    AudienceLastSentComponent,
    AudienceMissingSignalsComponent,
    AudienceQaPanelComponent,
  ],
  templateUrl: './audience-builder-tab.component.html',
  styleUrl: './audience-builder-tab.component.scss',
})
export class AudienceBuilderTabComponent {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly projectSlug = input.required<string>();
  /** True while this tab is the selected Email tab. Gates the one automatic request. */
  public readonly active = input(false);
  /** Seeded from the brief's event details when it has them, so the field is rarely empty. */
  public readonly initialEventUrl = input('');

  // === Forms ===
  protected readonly eventUrlControl = new FormControl('', { nonNullable: true });

  // === Constants ===
  protected readonly unionExactCap = AUDIENCE_UNION_EXACT_CAP;

  // === State: discovery ===
  protected readonly discovering = signal(false);
  protected readonly discoveryError = signal<string | null>(null);
  protected readonly progressMessage = signal<string | null>(null);
  protected readonly inspected = signal<number | null>(null);
  protected readonly identity = signal<AudienceDiscoveredEvent | null>(null);
  protected readonly discoveredLists = signal<readonly AudienceDiscoveredList[]>([]);
  protected readonly missingSignals = signal<readonly AudienceSignal[]>([]);
  protected readonly hasDiscovered = signal(false);

  // === State: reuse ===
  protected readonly reuseLoading = signal(false);
  protected readonly lastSentEmails = signal<readonly AudienceLastSentEmail[]>([]);
  protected readonly existingMasterLists = signal<readonly AudienceMasterListBrief[]>([]);

  // === State: suppression ===
  protected readonly suppressionLoading = signal(false);
  protected readonly suppressionLists = signal<readonly AudienceSuppressionList[]>([]);
  /**
   * True when the suppression fetch FAILED, as distinct from a portal that has no suppression
   * lists. The two produced identical DOM before this existed -- an empty array renders the grid's
   * "No suppression lists resolved yet" arm either way -- so a transport failure read as a
   * verified absence and `canCompose` let the operator write a real list with no regulatory
   * exclusions. The service deliberately returns unresolved rows with an empty `ListID` rather
   * than dropping them for exactly this reason; a failed request bypassed that care entirely.
   */
  protected readonly suppressionFailed = signal(false);
  /**
   * Which discovery run the in-flight requests belong to.
   *
   * Every request here is scoped only to component DESTRUCTION (`takeUntilDestroyed`), not to
   * the run that launched it. Clearing state in `resetRunState` therefore does not stop event
   * A's replies from landing: a late preview count, compose banner, or suppression list writes
   * itself over event B's screen — including a "Master list created" state the operator never
   * triggered for this event.
   *
   * Incremented on every new run; each response checks the generation it was issued under and
   * discards itself if the run has moved on. A counter rather than `switchMap` because the
   * responses write to several independent signals and the cancellation must cover all of
   * them uniformly, including the reuse/suppression batch that a later run re-issues.
   */
  /**
   * True when the capabilities request itself FAILED, as opposed to answering "not configured".
   * Both fail closed — every write stays disabled either way — but they need different copy:
   * one is an administrator task, the other is "try again".
   */
  protected readonly capabilitiesFailed = signal(false);

  private runGeneration = 0;
  /**
   * Whether a compose has been ATTEMPTED for this run, regardless of how it ended.
   *
   * Gating on composeResult/composePartial was not enough: an ordinary failure leaves both
   * null, so the same non-idempotent write re-enabled immediately. That matters most for the
   * case upstream reports as a plain 500 — an UNCONFIRMED HubSpot mutation, whose own message
   * says to check the portal before retrying, because a list may already exist. Clicking again
   * is exactly how the duplicate gets created. Cleared only by resetRunState.
   */
  protected readonly composeAttempted = signal(false);
  /** Per-section reuse fetch failures — see AudienceLastSentComponent for why these are separate. */
  protected readonly mastersFailed = signal(false);
  /**
   * Separate from `reuseLoading`, which the last-sent request owns. The two run independently,
   * so clearing one shared flag when last-sent returned made the master section claim "no
   * master list has been built for this event yet" while its own request was still in flight —
   * indefinitely, if that request stalled.
   */
  protected readonly mastersLoading = signal(false);
  protected readonly emailsFailed = signal(false);

  // === State: manual search ===
  protected readonly searching = signal(false);
  protected readonly searchResults = signal<readonly AudienceListSearchResult[]>([]);

  // === State: selection (id -> display name) ===
  private readonly inclusion = signal<ReadonlyMap<string, string>>(new Map());
  private readonly suppression = signal<ReadonlyMap<string, string>>(new Map());

  // === State: preview & compose ===
  protected readonly previewing = signal(false);
  protected readonly previewCount = signal<AudiencePreviewCount | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly composing = signal(false);
  protected readonly composeResult = signal<AudienceComposeMasterResult | null>(null);
  protected readonly composePartial = signal<AudienceComposeMasterPartial | null>(null);
  protected readonly composeError = signal<string | null>(null);

  // === Computed Signals ===
  /**
   * Capabilities, fetched once per PROJECT once the tab is first shown for it.
   *
   * Previously `take(1)`, on the reasoning that the answer "cannot change within a session".
   * That holds for a tab switch — the panel is never destroyed, so a plain `switchMap` would
   * re-request needlessly — but NOT for a project switch: the campaigns component stays mounted
   * across `activeFoundationSlug` changes, so the first project's answer was cached forever and
   * the second project inherited it. A portal with no HubSpot connection then presented as
   * configured, and every write went to the new slug carrying the old portal's state.
   *
   * Keyed on the slug instead: `distinctUntilChanged` keeps the tab-switch economy (the slug
   * does not change when you leave and return) while a real project change refetches.
   */
  protected readonly capabilities = toSignal(
    combineLatest([toObservable(this.active), toObservable(this.projectSlug)]).pipe(
      filter(([active]) => active),
      map(([, slug]) => slug),
      distinctUntilChanged(),
      // Catch INSIDE the inner request, not on the outer pipe. An outer catchError emits its
      // fallback and COMPLETES the slug stream, so one failed capabilities call would leave the
      // tab degraded for the rest of the session — no later project switch could refetch. This
      // was introduced converting away from `take(1)`, where completing was the intent.
      switchMap((slug) =>
        this.campaignService.getAudienceCapabilities(slug).pipe(
          // `tap` BEFORE `catchError`: it runs only on the success path. After it, it would
          // also run on the value catchError emits and immediately clear the flag that arm
          // had just set.
          tap(() => this.capabilitiesFailed.set(false)),
          catchError(() => {
            // Fail CLOSED, but do not claim to know WHY. A failed capabilities call can be a
            // gateway or campaign-service outage just as easily as an unconfigured portal;
            // reporting the latter sends the operator to fix credentials that are fine.
            this.capabilitiesFailed.set(true);
            return of<AudienceBuilderCapabilities>({ hubspotConfigured: false });
          })
        )
      )
    ),
    { initialValue: null }
  );

  /** True when HubSpot credentials are absent — every write action is disabled and a banner shows. */
  /**
   * True whenever the portal is not KNOWN to be usable — which includes "not yet answered".
   *
   * `toSignal` starts at null and keeps project A's value while project B's request is in
   * flight, and `?.hubspotConfigured === false` read both as "fine". Writes were therefore
   * enabled before the first capability check returned — indefinitely if it stalled — and
   * briefly against a new project that may have no HubSpot connection at all. Only an explicit
   * `true` for the CURRENT project opens the panel.
   */
  protected readonly degraded = computed(() => this.capabilities()?.hubspotConfigured !== true);

  protected readonly inclusionIds = computed<ReadonlySet<string>>(() => new Set(this.inclusion().keys()));
  protected readonly suppressionIds = computed<ReadonlySet<string>>(() => new Set(this.suppression().keys()));

  /** Every selected id, so a child can grey out an Add button for a list already in either set. */
  protected readonly selectedIds = computed<ReadonlySet<string>>(() => new Set([...this.inclusion().keys(), ...this.suppression().keys()]));

  protected readonly inclusionEntries = computed(() => [...this.inclusion()].map(([listId, name]) => ({ listId, name })));

  /**
   * The exclusions actually sent to compose: suppression minus inclusion.
   *
   * A list ticked on both sides is a contradiction the operator cannot see resolved anywhere else,
   * and HubSpot would apply both filters and return nobody. Inclusion wins because it is the
   * explicit intent — the suppression tick is a recommendation this component made.
   */
  protected readonly excludeIds = computed(() => [...this.suppression().keys()].filter((id) => !this.inclusion().has(id)));

  /**
   * Lists ticked on BOTH sides. Resolving this silently was the defect: `excludeIds` drops the
   * exclusion and both checkboxes stay ticked, so the panel states a GDPR or opt-out list will
   * be applied while the request omits it — and the send reaches contacts the operator believes
   * were suppressed. Surfaced and blocking instead, because which side should win is the
   * operator's call, not a rule this component can make on their behalf.
   */
  protected readonly conflictingIds = computed(() => [...this.suppression().keys()].filter((id) => this.inclusion().has(id)));

  protected readonly conflictNames = computed(() =>
    this.conflictingIds()
      .map((id) => this.suppression().get(id) ?? this.inclusion().get(id) ?? id)
      .sort((a, b) => a.localeCompare(b))
  );

  /** The nine signal buckets, in report order, with empty ones dropped. */
  protected readonly buckets = computed<readonly AudienceCardBucket[]>(() => {
    const lists = this.discoveredLists();
    return AUDIENCE_SIGNAL_ORDER.map((signalKey) => ({
      signal: signalKey,
      label: AUDIENCE_SIGNAL_INFO[signalKey].label,
      description: AUDIENCE_SIGNAL_INFO[signalKey].description,
      accentClass: AUDIENCE_SIGNAL_INFO[signalKey].accentClass,
      lists: lists.filter((list) => list.signal === signalKey),
    }));
  });

  /**
   * Compose is BLOCKED while the suppression fetch is unresolved or failed.
   *
   * This write is non-idempotent and creates real contact lists in the project's portal, so it
   * must not proceed on an audience whose regulatory exclusions could not be read. A failed fetch
   * is not an empty portal, and the difference is the whole point of the check.
   */
  /**
   * Compose is a non-idempotent WRITE to a production portal, so this gate fails closed on
   * every state where the suppression context is not yet known to be complete.
   *
   * `suppressionFailed` alone was not enough. It is false in two other states that must also
   * block: while the fetch is still IN FLIGHT (the review pane renders as soon as discovery
   * returns, so there is a real window where an operator can compose before GDPR/CASL
   * exclusions have arrived), and when discovery produced no event identity, in which case
   * the fetch never ran at all — see `loadReuseAndSuppression`.
   *
   * It also blocks once a compose has already produced a result or a partial. The same
   * selection composing twice creates a duplicate master list, and the partial case is
   * explicitly the one the operator must reconcile by hand rather than retry.
   */
  protected readonly canCompose = computed(
    () =>
      !this.degraded() &&
      !this.composing() &&
      !this.suppressionFailed() &&
      !this.suppressionLoading() &&
      !this.composeAttempted() &&
      this.conflictingIds().length === 0 &&
      this.inclusion().size > 0
  );

  public constructor() {
    // A project switch must drop the previous portal's audience state, not just refetch
    // capabilities. The campaigns component stays mounted across `activeFoundationSlug`
    // changes, so discovered lists, ticks, preview counts and compose banners all survived —
    // and HubSpot list ids are numeric and portal-scoped, so an id ticked in portal A can
    // collide with an unrelated list in portal B and compose it.
    //
    // `resetRunState` already invalidates in-flight replies via the run generation, so a
    // request issued for the old project cannot write after this either.
    toObservable(this.projectSlug)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.resetRunState();
        this.eventUrlControl.setValue('', { emitEvent: false });
      });

    toObservable(this.initialEventUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((url) => {
        // Seed only; never overwrite a URL the operator has already typed.
        if (url && this.eventUrlControl.pristine) {
          this.eventUrlControl.setValue(url);
        }
      });

    // Disabling a reactive control has to go through the control, not a `[disabled]` binding on the
    // input: the binding fights the directive and Angular warns it can produce a
    // changed-after-checked error. Every other action here is a plain button, so this is the only
    // control that needs it.
    toObservable(this.degraded)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((degraded) => {
        if (degraded) {
          this.eventUrlControl.disable({ emitEvent: false });
        } else {
          this.eventUrlControl.enable({ emitEvent: false });
        }
      });
  }

  // === Protected Methods: discovery ===
  protected onDiscover(): void {
    const eventUrl = this.eventUrlControl.value.trim();
    if (this.degraded() || this.discovering() || eventUrl.length === 0) {
      return;
    }

    this.discovering.set(true);
    this.discoveryError.set(null);
    this.progressMessage.set('Starting discovery...');
    this.inspected.set(null);
    this.resetRunState();
    // Captured AFTER resetRunState, which has just incremented the generation — this stream
    // belongs to the run it starts. The SSE stream needed this most of all: it is the one that
    // repopulates identity and the discovered list ids, so a late frame from project A would
    // restore A's ids after the panel is scoped to project B, and the follow-up lookups would
    // then run against B carrying them.
    const run = this.runGeneration;

    this.campaignService
      .discoverAudience(this.projectSlug(), { eventUrl })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: SSEEvent<AudienceDiscoverySSEEventType>) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.handleDiscoveryEvent(event);
        },
        error: (httpErr: HttpErrorResponse) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.discoveryError.set(extractErrorMessage(httpErr, 'Audience discovery failed'));
          this.discovering.set(false);
          this.progressMessage.set(null);
        },
        complete: () => {
          if (run !== this.runGeneration) {
            return;
          }
          this.discovering.set(false);
          this.progressMessage.set(null);
        },
      });
  }

  // === Protected Methods: selection ===
  protected onToggleDiscovered(listId: string): void {
    const list = this.discoveredLists().find((candidate) => candidate.listId === listId);
    this.toggle(this.inclusion, listId, list?.name ?? listId);
  }

  protected onToggleSuppression(listId: string): void {
    const list = this.suppressionLists().find((candidate) => candidate.listId === listId);
    this.toggle(this.suppression, listId, list?.name ?? listId);
  }

  protected onAddListBrief(list: AudienceListBrief): void {
    this.add(list.listId, list.name);
  }

  protected onAddMasterList(list: AudienceMasterListBrief): void {
    this.add(list.listId, list.name);
  }

  protected onAddSearchResult(list: AudienceListSearchResult): void {
    this.add(list.listId, list.name);
  }

  protected onRemoveInclusion(listId: string): void {
    const next = new Map(this.inclusion());
    next.delete(listId);
    this.inclusion.set(next);
    this.invalidatePreview();
  }

  // === Protected Methods: manual search ===
  protected onSearch(query: string): void {
    if (query.length === 0) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }

    this.searching.set(true);
    const run = this.runGeneration;
    this.campaignService
      .searchAudienceLists(this.projectSlug(), query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.searchResults.set(results);
          this.searching.set(false);
        },
        error: () => {
          // A failed typeahead is not worth a banner — the operator's next keystroke retries it.
          this.searchResults.set([]);
          this.searching.set(false);
        },
      });
  }

  // === Protected Methods: preview & compose ===
  protected onPreviewCount(): void {
    const listIds = [...this.inclusion().keys()];
    if (this.degraded() || this.previewing() || listIds.length === 0) {
      return;
    }

    this.previewing.set(true);
    const run = this.runGeneration;
    this.previewError.set(null);
    this.campaignService
      .previewAudienceCount(this.projectSlug(), { listIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (count) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.previewCount.set(count);
          this.previewing.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          this.previewError.set(extractErrorMessage(httpErr, 'Failed to preview the audience size'));
          this.previewCount.set(null);
          this.previewing.set(false);
        },
      });
  }

  /**
   * Creates the Combined Suppression list and the master list in HubSpot.
   *
   * There is deliberately no retry affordance on failure: compose is not idempotent, so a second
   * click after a partial failure leaves a duplicate suppression list behind. A partial result is
   * surfaced with a link into HubSpot so the operator can finish or clean up by hand.
   */
  protected onComposeMaster(): void {
    if (!this.canCompose()) {
      return;
    }

    const event = this.identity();
    this.composing.set(true);
    this.composeAttempted.set(true);
    const run = this.runGeneration;
    this.composeError.set(null);
    this.composePartial.set(null);

    this.campaignService
      .composeAudienceMaster(this.projectSlug(), {
        listIds: [...this.inclusion().keys()],
        excludeListIds: this.excludeIds(),
        eventUrl: this.eventUrlControl.value.trim() || undefined,
        brandShort: event?.brandShort,
        eventName: event?.eventName,
        eventDates: event?.eventDates,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.composeResult.set(result);
          this.composing.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          if (run !== this.runGeneration) {
            return;
          }
          // A 502 alone does not make this a partial compose. An ordinary gateway or network
          // 502 carries no created list — often an HTML error page — and casting it would
          // render "Partially completed" for a compose that created NOTHING, hiding the real
          // error and telling the operator to reconcile a list that does not exist. The
          // suppression object with a real list id is what actually distinguishes the two.
          const partial = httpErr.status === 502 ? this.asComposePartialBody(httpErr.error) : null;
          if (partial) {
            this.composePartial.set(partial);
          } else {
            this.composeError.set(extractErrorMessage(httpErr, 'Failed to compose the master list'));
          }
          this.composing.set(false);
        },
      });
  }

  // === Protected Methods: formatting ===
  /**
   * The union size as text.
   *
   * `exact: false` arrives from TWO different server paths and they must not render the same way:
   *
   *   - OVER CAP — the server stopped counting because the sum passed `AUDIENCE_UNION_EXACT_CAP`,
   *     so `25,000+` is true and a precise-looking partial total would be quietly short.
   *   - DEGRADED — the membership sweep failed or was truncated, and upstream returns the naive
   *     SUM as the estimate. That path is only reachable BELOW the cap (`audience_explorer.go`
   *     returns early once `ExceedsExactCap` holds), so labelling it `25,000+` overstates a
   *     1,200-contact audience by 20x — and overstating reach is the direction
   *     `DegradedPreviewCount` exists to prevent.
   *
   *   - UNKNOWN SIZE — a selected list did not report a size at all, so upstream returns
   *     `estimate: 0` with a reason rather than a total that would be short by that whole list.
   *
   * The first two are told apart by the estimate, not by `exact` alone: only the over-cap path can
   * have one above the cap. A degraded count is shown as approximate so the figure never reads as
   * a verified floor, and a zero estimate is not rendered as a number at all — "~0" would claim an
   * audience of approximately nobody, which is the fabricated measurement this whole type avoids.
   */
  protected countLabel(count: AudiencePreviewCount): string {
    if (count.exact) {
      return count.count.toLocaleString('en-US');
    }
    // STRICTLY greater, mirroring the server's `ExceedsExactCap`: an estimate of exactly the cap
    // IS countable there (MembershipPageSize * MembershipMaxPages is exactly that many records),
    // so at the cap the sweep RAN. A `>=` here relabels a sweep that ran and failed as one the
    // server refused for being too big -- the same overstatement this method exists to prevent,
    // surviving at exactly one value.
    if (count.estimate > AUDIENCE_UNION_EXACT_CAP) {
      return `${AUDIENCE_UNION_EXACT_CAP.toLocaleString('en-US')}+`;
    }
    // An inexact ZERO is not a measurement of zero people — it is upstream saying it has no
    // trustworthy total. TWO server states produce it: a list whose size HubSpot did not report
    // (UnknownSizePreviewCount), and a failed sweep over lists that really are empty
    // (DegradedPreviewCount(0)). They are deliberately NOT distinguished here: both mean "no
    // number can be trusted", the label is the same either way, and `reason` — rendered beside
    // this label — already names which one it was. A genuinely empty selection is unaffected:
    // EmptyPreviewCount is `exact: true` and returns above.
    if (count.estimate === 0) {
      return 'No reliable total';
    }
    return `~${count.estimate.toLocaleString('en-US')}`;
  }

  // === Private Methods ===
  private handleDiscoveryEvent(event: SSEEvent<AudienceDiscoverySSEEventType>): void {
    switch (event.type) {
      case 'progress': {
        const progress = event.data as AudienceDiscoveryProgress;
        this.progressMessage.set(progress.message);
        this.inspected.set(progress.inspected ?? null);
        break;
      }
      case 'event':
        this.identity.set(event.data as AudienceDiscoveredEvent);
        break;
      case 'discovered': {
        const result = event.data as AudienceDiscoveryResult;
        this.discoveredLists.set(result.lists);
        this.missingSignals.set(result.missingSignals);
        this.hasDiscovered.set(true);
        this.loadReuseAndSuppression();
        break;
      }
      case 'error':
        this.discoveryError.set(typeof event.data === 'string' ? event.data : 'Audience discovery failed');
        this.discovering.set(false);
        break;
      case 'shutdown':
        this.discoveryError.set('Discovery was interrupted by a server restart. Please run it again.');
        this.discovering.set(false);
        break;
      case 'done':
        this.discovering.set(false);
        this.progressMessage.set(null);
        break;
    }
  }

  /** Loads the post-discovery lookups: suppression always, reuse only when an event was named. */
  private loadReuseAndSuppression(): void {
    const event = this.identity();

    // Suppression is fetched even with NO event identity. Returning early here left
    // `suppressionFailed` false and `suppressionLoading` false on a portal that was never
    // queried — which reads downstream as "this portal has no regulatory exclusions",
    // the one answer that must never be inferred. The portfolio-wide hygiene lists
    // (GDPR, global opt-out) are not event-scoped and resolve without a name; only the
    // brand-scoped probes need one, and the service already returns the standard rows
    // regardless.
    this.loadSuppression(event?.brandShort ?? '', event?.eventName ?? '');

    // Reuse (send history, existing masters) IS event-scoped: both search by event name,
    // so without one there is nothing to ask for.
    if (event === null) {
      return;
    }

    this.reuseLoading.set(true);
    const run = this.runGeneration;
    this.campaignService
      .getAudienceLastSent(this.projectSlug(), event.eventName, event.brandShort)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (emails) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.lastSentEmails.set(emails);
          this.emailsFailed.set(false);
          this.reuseLoading.set(false);
        },
        error: () => {
          if (run !== this.runGeneration) {
            return;
          }
          this.lastSentEmails.set([]);
          this.emailsFailed.set(true);
          this.reuseLoading.set(false);
        },
      });

    this.mastersLoading.set(true);
    this.campaignService
      .getAudienceExistingMasterLists(this.projectSlug(), event.eventName, event.brandShort)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.existingMasterLists.set(lists);
          this.mastersFailed.set(false);
          this.mastersLoading.set(false);
        },
        error: () => {
          if (run !== this.runGeneration) {
            return;
          }
          this.existingMasterLists.set([]);
          this.mastersFailed.set(true);
          this.mastersLoading.set(false);
        },
      });

    // (suppression is loaded above, before the identity guard)
  }

  /** Fetches the suppression lists. Safe with empty scope: the hygiene rows are portfolio-wide. */
  private loadSuppression(brandShort: string, eventName: string): void {
    this.suppressionLoading.set(true);
    const run = this.runGeneration;
    this.campaignService
      .getAudienceSuppressionLists(this.projectSlug(), brandShort, eventName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.suppressionLists.set(lists);
          this.suppressionFailed.set(false);
          this.suppressionLoading.set(false);
        },
        error: () => {
          if (run !== this.runGeneration) {
            return;
          }
          this.suppressionLists.set([]);
          this.suppressionFailed.set(true);
          this.suppressionLoading.set(false);
        },
      });
  }

  private add(listId: string, name: string): void {
    if (this.inclusion().has(listId)) {
      return;
    }
    const next = new Map(this.inclusion());
    next.set(listId, name);
    this.inclusion.set(next);
    this.invalidatePreview();
  }

  private toggle(target: typeof this.inclusion, listId: string, name: string): void {
    const next = new Map(target());
    if (next.has(listId)) {
      next.delete(listId);
    } else {
      next.set(listId, name);
    }
    target.set(next);
    this.invalidatePreview();
  }

  /** A count computed for a different selection is misinformation, so it is dropped on every edit. */
  /**
   * Clears everything scoped to ONE discovery run, so a second event cannot inherit the first's
   * selection.
   *
   * `invalidatePreview()` already does this for a selection EDIT, on the principle that a count
   * computed against different inputs is misinformation. A new discovery is the same defect one
   * level up and with a worse ending: compose is a non-idempotent WRITE to the production HubSpot
   * portal, so a surviving inclusion id creates a master list named for the new event while
   * containing the previous event's contacts — and it looks entirely legitimate afterwards.
   *
   * `hasDiscovered` goes false so section 2 unmounts for the duration of the run rather than
   * showing the previous event's cards, suppression rows and compose banner labelled as current.
   */
  /**
   * Narrows an error body to a compose-partial ONLY when it carries the state that makes one
   * actionable: a suppression list with a real id. That id is the whole point of the partial
   * contract — it is the orphan the operator must reconcile in HubSpot before composing again.
   * A body without it is an ordinary failure, however it was framed.
   */
  private asComposePartialBody(body: unknown): AudienceComposeMasterPartial | null {
    if (body === null || typeof body !== 'object') {
      return null;
    }
    const suppression = (body as { suppression?: { listId?: unknown } }).suppression;
    if (suppression === undefined || suppression === null || typeof suppression !== 'object') {
      return null;
    }
    const listId = (suppression as { listId?: unknown }).listId;
    return typeof listId === 'string' && listId.length > 0 ? (body as AudienceComposeMasterPartial) : null;
  }

  private resetRunState(): void {
    // Invalidate every in-flight reply from the previous run BEFORE clearing the state they
    // would otherwise repopulate.
    this.runGeneration += 1;
    this.composing.set(false);
    this.previewing.set(false);
    // Discovery activity must reset too. The generation bump above DISCARDS the old stream's
    // completion, so without this a project switch mid-discovery leaves `discovering` true
    // forever and the new project's Discover button permanently disabled — the guard causing
    // the stall it was added to prevent.
    this.discovering.set(false);
    this.progressMessage.set(null);
    this.inspected.set(null);
    this.reuseLoading.set(false);
    this.mastersLoading.set(false);
    this.suppressionLoading.set(false);
    this.hasDiscovered.set(false);
    this.identity.set(null);
    this.discoveredLists.set([]);
    this.missingSignals.set([]);
    this.lastSentEmails.set([]);
    this.existingMasterLists.set([]);
    this.suppressionLists.set([]);
    this.suppressionFailed.set(false);
    this.mastersFailed.set(false);
    this.emailsFailed.set(false);
    this.searchResults.set([]);
    this.inclusion.set(new Map());
    this.suppression.set(new Map());
    this.composeResult.set(null);
    this.composePartial.set(null);
    this.composeError.set(null);
    this.composeAttempted.set(false);
    this.invalidatePreview();
  }

  private invalidatePreview(): void {
    this.previewCount.set(null);
    this.previewError.set(null);
  }
}
