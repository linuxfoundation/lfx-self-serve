// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, filter, of, switchMap, take } from 'rxjs';

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
  /** Per-section reuse fetch failures — see AudienceLastSentComponent for why these are separate. */
  protected readonly mastersFailed = signal(false);
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
   * Capabilities, fetched once the tab is first shown.
   *
   * `take(1)` after `filter` is what makes this fire exactly once, on first activation: the panel
   * is never destroyed on a tab switch, so a plain `switchMap` would re-request on every return to
   * the tab for an answer that cannot change within a session.
   */
  protected readonly capabilities = toSignal(
    toObservable(this.active).pipe(
      filter((active) => active),
      take(1),
      switchMap(() => this.campaignService.getAudienceCapabilities(this.projectSlug())),
      catchError(() => of<AudienceBuilderCapabilities>({ hubspotConfigured: false }))
    ),
    { initialValue: null }
  );

  /** True when HubSpot credentials are absent — every write action is disabled and a banner shows. */
  protected readonly degraded = computed(() => this.capabilities()?.hubspotConfigured === false);

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
  protected readonly canCompose = computed(() => !this.degraded() && !this.composing() && !this.suppressionFailed() && this.inclusion().size > 0);

  public constructor() {
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

    this.campaignService
      .discoverAudience(this.projectSlug(), { eventUrl })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: SSEEvent<AudienceDiscoverySSEEventType>) => this.handleDiscoveryEvent(event),
        error: (httpErr: HttpErrorResponse) => {
          this.discoveryError.set(extractErrorMessage(httpErr, 'Audience discovery failed'));
          this.discovering.set(false);
          this.progressMessage.set(null);
        },
        complete: () => {
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
    this.campaignService
      .searchAudienceLists(this.projectSlug(), query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
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
    this.previewError.set(null);
    this.campaignService
      .previewAudienceCount(this.projectSlug(), { listIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (count) => {
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
          this.composeResult.set(result);
          this.composing.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          const partial = httpErr.status === 502 ? (httpErr.error as AudienceComposeMasterPartial | null) : null;
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
   * The two are told apart by the estimate, not by `exact` alone: only the over-cap path can have
   * one at or above the cap. A degraded count is shown as approximate so the figure never reads
   * as a verified floor.
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

  /** Loads the three event-scoped lookups once discovery has named the event. */
  private loadReuseAndSuppression(): void {
    const event = this.identity();
    if (event === null) {
      return;
    }

    this.reuseLoading.set(true);
    this.campaignService
      .getAudienceLastSent(this.projectSlug(), event.eventName, event.brandShort)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (emails) => {
          this.lastSentEmails.set(emails);
          this.emailsFailed.set(false);
          this.reuseLoading.set(false);
        },
        error: () => {
          this.lastSentEmails.set([]);
          this.emailsFailed.set(true);
          this.reuseLoading.set(false);
        },
      });

    this.campaignService
      .getAudienceExistingMasterLists(this.projectSlug(), event.eventName, event.brandShort)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          this.existingMasterLists.set(lists);
          this.mastersFailed.set(false);
        },
        error: () => {
          this.existingMasterLists.set([]);
          this.mastersFailed.set(true);
        },
      });

    this.suppressionLoading.set(true);
    this.campaignService
      .getAudienceSuppressionLists(this.projectSlug(), event.brandShort, event.eventName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          this.suppressionLists.set(lists);
          this.suppressionFailed.set(false);
          this.suppressionLoading.set(false);
        },
        error: () => {
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
  private resetRunState(): void {
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
    this.invalidatePreview();
  }

  private invalidatePreview(): void {
    this.previewCount.set(null);
    this.previewError.set(null);
  }
}
