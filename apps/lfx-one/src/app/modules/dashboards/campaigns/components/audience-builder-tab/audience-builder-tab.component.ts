// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { outputFromObservable, takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CampaignService } from '@services/campaign.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, pairwise, startWith, switchMap, tap } from 'rxjs';

import {
  AUDIENCE_ATTACH_MAX_LIST_IDS,
  AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH,
  AUDIENCE_SIGNAL_INFO,
  AUDIENCE_SIGNAL_ORDER,
  AUDIENCE_UNION_EXACT_CAP,
} from '@lfx-one/shared/constants';
import type {
  AudienceAttachExistingRequest,
  AudienceAttachExistingResult,
  AudienceBriefState,
  AudienceBuilderCapabilities,
  AudienceCardBucket,
  AudienceComposeMasterPartial,
  AudienceComposeMasterResult,
  AudienceComposedList,
  AudienceComposeUnattachedEvent,
  AudienceDiscoveredEvent,
  AudienceDiscoveredList,
  AudienceDiscoveryProgress,
  AudienceDiscoveryResult,
  AudienceDiscoverySSEEventType,
  AudienceLastSentEmail,
  AudienceListBrief,
  AudienceListRef,
  AudienceListSearchResult,
  AudienceMasterListBrief,
  AudiencePreviewCount,
  AudienceSignal,
  AudienceSuppressionList,
  CampaignAudience,
  SSEEvent,
} from '@lfx-one/shared/interfaces';

import { AudienceCardGridComponent } from '../audience-card-grid/audience-card-grid.component';
import { AudienceLastSentComponent } from '../audience-last-sent/audience-last-sent.component';
import { AudienceMissingSignalsComponent } from '../audience-missing-signals/audience-missing-signals.component';
import { AudienceQaPanelComponent } from '../audience-qa-panel/audience-qa-panel.component';
import { AudienceStepCardComponent } from '../audience-step-card/audience-step-card.component';
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
    AudienceStepCardComponent,
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
  /**
   * The identity of the event the parent's brief is for (slug, then name, then URL), normalized.
   *
   * The advertised URL alone could not tell events apart: two briefs with no registration URL, or two
   * events sharing one, looked identical, so event A's lists survived into event B's brief. Falls
   * back to the URL when the parent passes no key.
   */
  public readonly eventKey = input('');
  /**
   * The brief a composed master should be attached to, empty when there is none yet.
   *
   * Empty does NOT disable compose, and that is deliberate rather than an omission. These routes
   * are project-scoped precisely so the builder can be used before any campaign exists -- the
   * exploratory path -- so refusing to compose without a brief would remove a supported use. What
   * an empty id changes is the OUTCOME, which the template states inline: the lists are created
   * but attached to nothing.
   */
  public readonly briefId = input('');
  /**
   * The brief's existing audience could not be READ back, as distinct from it having none.
   *
   * A failed read left `emailAudience` null, which is byte-identical to a brief that never had
   * one -- and this tab then offered compose, so an outage that hid an existing audience let the
   * operator create a SECOND HubSpot master list for the same brief. Compose is irreversible and
   * not idempotent, so a duplicate is real work to unpick.
   *
   * Gated the same way `suppressionFailed` is: an unverifiable absence is not an absence.
   */
  public readonly audienceReadFailed = input(false);
  /**
   * The brief's existing audience is still being READ.
   *
   * The same unknown as a failed read, for as long as the request takes: the parent opens this tab
   * on restore before the read returns, so a slow read let the operator write a second audience on
   * top of the one about to be revealed.
   */
  public readonly audienceReadPending = input(false);
  /**
   * The saved-audience lookup is switched OFF in this environment (the briefs flag is dark), so
   * the brief's audience cannot be verified at all. Gated like a failure, but not retryable: a retry
   * gets the same answer, so the copy must not offer one.
   */
  public readonly audienceReadUnavailable = input(false);
  /**
   * The send audience the parent already holds for this brief -- restored on reload, or recorded
   * by an earlier compose or attach.
   *
   * Without it a restored brief mounted a fresh builder: both read flags were false once the read
   * answered, `composeAttempted` was false, and compose was offered for a brief that already had a
   * built audience -- minting a second HubSpot master with nothing on screen saying one existed.
   * Compose now blocks on it until the operator explicitly asks to replace it.
   */
  public readonly existingAudience = input<CampaignAudience | null>(null);
  /**
   * The parent's brief-state generation, stamped onto an unattached-compose event at dispatch.
   *
   * A brief-less compose has no brief id to scope its warning by, so after a reset its late reply
   * was filed under the shared brief-less key and shown on the NEXT brief. The parent drops a
   * brief-less event whose scope no longer matches.
   */
  public readonly audienceScope = input(0);
  /**
   * The parent is STAGING a send, or its last stage is unresolved (a draft may still be created) --
   * either way a HubSpot draft may resolve this brief's audience.
   *
   * The other half of `audienceWriteInFlight`. Stage waits for an audience write, and this makes the
   * exclusion two-way: a compose or attach started while the create is on the wire could change
   * which audience that draft resolves to, and the create carries only the brief id.
   */
  public readonly stagingInFlight = input(false);
  /**
   * Why `briefId` is empty, when it is.
   *
   * The parent saves the brief on its own as this tab opens, so an empty id almost never means
   * "the plan was not saved". It means the save is still running, failed, produced a brief that
   * is not approved, or found a brief this session does not own (`'unopened'`). Telling the operator to save the plan on the Plan tab sent them to a step they
   * had already done, with no way to recover.
   */
  public readonly briefState = input<AudienceBriefState>('none');
  /** The parent's conflict-specific recovery for a failed save; replaces the generic failure copy. */
  public readonly briefSaveMessage = input('');

  // === Outputs ===
  /**
   * The composed master was recorded upstream as the brief's built send audience.
   *
   * Emitted with the audience row rather than a list id, so the parent can put it straight on the
   * signal that gates staging. The parent is not asked to re-read anything: the attach happened
   * inside the compose, and this row is the service's own record of it.
   */
  public readonly audienceAttached = output<CampaignAudience>();
  /**
   * The master list was created and NOT attached to a brief.
   *
   * Two different situations reach it -- no brief id was available, and a brief id was sent but
   * the recording failed -- and the parent renders the same reconcile warning for both, because
   * the operator's position is identical: a real HubSpot list exists that the send does not know
   * about. Carries the composed list itself rather than a flattened copy of three of its fields --
   * the parent renders the same name and HubSpot link this tab does, off the same shape.
   */
  public readonly audienceComposeUnattached = output<AudienceComposeUnattachedEvent>();
  /**
   * The operator is done here and wants the Implement tab. Emitted from beside the compose / attach
   * result, which sits at the bottom of a long panel — the parent's step bar is a screen away.
   */
  public readonly continueToEmail = output<void>();
  /** Re-read the brief's saved audience after a read that failed or could not run. */
  public readonly retryAudienceRead = output<void>();
  /**
   * Whether a write to the brief's send audience (compose or attach) is on the wire.
   *
   * The parent gates staging on it. `canStageEmail` read only the recorded audience, so during a
   * re-attach or a replacement compose Stage stayed enabled on the OLD audience -- and the draft it
   * cloned pointed at a list the operator was in the middle of replacing.
   */
  public readonly audienceWriteInFlight = outputFromObservable(
    toObservable(computed(() => this.composeOnWire() || this.attachInFlight())).pipe(distinctUntilChanged())
  );
  /** Save the brief again after the save the parent started on its own failed. */
  public readonly retryBrief = output<void>();

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
  /** The URL the current discovery ran for, so an edited field is compared by what it discovered. */
  private readonly discoveredEventUrl = signal('');

  // === State: reuse ===
  protected readonly reuseLoading = signal(false);
  protected readonly lastSentEmails = signal<readonly AudienceLastSentEmail[]>([]);
  protected readonly existingMasterLists = signal<readonly AudienceMasterListBrief[]>([]);
  /** Masters this panel composed but could not record. See `rememberComposedMaster`. */
  private readonly composedMasterLists = signal<readonly AudienceMasterListBrief[]>([]);
  /**
   * What the reuse grid shows: this panel's own composed masters first, then the fetched ones, with
   * a fetched row winning on a shared id because it carries the portal's current size.
   */
  protected readonly reuseMasterLists = computed<readonly AudienceMasterListBrief[]>(() => {
    const fetched = this.existingMasterLists();
    const known = new Set(fetched.map((list) => list.listId));
    return [...this.composedMasterLists().filter((list) => !known.has(list.listId)), ...fetched];
  });

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
   * `runGeneration` orders runs; these order requests WITHIN a run. A typeahead fires one request
   * per keystroke and a preview one per click, so two can be in flight against the same run — the
   * generation guard cannot separate them and a slow first reply would overwrite a fast second.
   */
  private searchSeq = 0;
  private previewSeq = 0;
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
  /** The event url a compose was attempted for, so re-discovering it cannot clear the latch. */
  private readonly composedEventUrl = signal('');
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
  /**
   * Ticked suppression rows, keyed by the row KEY and holding its resolved list id. Several
   * standard terms can resolve to the same HubSpot list, so the key is the selection identity —
   * keying this by list id made those rows tick and untick as one. The ids are de-duplicated
   * where they are actually used (`excludeIds`), not where they are stored.
   */
  private readonly suppression = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Lists the operator marked as EXCLUSIONS from steps 2, 4 or 5 (list id -> name): their contacts
   * are kept off the send, exactly like a ticked suppression row. Kept apart from `suppression`
   * because that map is keyed by grid row and these lists have no row there.
   *
   * Mutually exclusive with `inclusion`: marking a list one way removes it from the other, so a list
   * can never be both included and excluded through these controls.
   */
  private readonly exclusion = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Whether this run's suppression rows have been pre-ticked yet. Seeded once per discovery run so a
   * row the operator unticked does not tick itself again on a later reload of the same run.
   */
  private readonly suppressionSeeded = signal(false);

  // === State: preview & compose ===
  protected readonly previewing = signal(false);
  protected readonly previewCount = signal<AudiencePreviewCount | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly composing = signal(false);
  protected readonly composeResult = signal<AudienceComposeMasterResult | null>(null);
  /** The composed master's id, handed to QA as its suggested target. Empty until a compose succeeds. */
  protected readonly composedMasterListId = computed(() => this.composeResult()?.master.listId ?? '');
  protected readonly composePartial = signal<AudienceComposeMasterPartial | null>(null);
  protected readonly composeError = signal<string | null>(null);

  // === Attach existing lists (no compose) ===
  /** The send / master list id an attach is in flight for; null when idle. */
  protected readonly attachingId = signal<string | null>(null);
  protected readonly attachResult = signal<AudienceAttachExistingResult | null>(null);
  /**
   * The exclusion ids the last attach actually SENT, so a prior send is matched on its whole
   * selection rather than on its master list id.
   */

  /**
   * Which of the two audience writes recorded LAST.
   *
   * `attachedListId` preferred the attach result unconditionally, so attaching and then
   * composing showed the attached list while the brief recorded the composed one. The writes
   * are serialized, so exactly one is in flight at a time and "last" is unambiguous.
   */
  private readonly lastWriteWasAttach = signal<boolean>(false);
  protected readonly attachError = signal<string | null>(null);
  /**
   * An attach is on the wire, from dispatch until its reply SETTLES -- whatever brief is on screen.
   *
   * Separate from `attachingId`, which is the spinner and is cleared on a brief switch so the new
   * brief does not show the old one's. Gating writes on the spinner released the guard while the
   * request was still running: switch A -> B -> A and a second attach for A could start, and if its
   * reply landed first the older one then overwrote the record with the earlier selection. Writes
   * are serialized on this instead, so there is never a second reply to arrive out of order.
   *
   * Released ONLY when the request settles (a `finalize` on the request itself), never by a reset:
   * a reset discards the reply, but the request is still being recorded upstream, and releasing
   * early let a context switch A -> B -> A start a second write against the first.
   */
  protected readonly attachInFlight = signal(false);
  /**
   * A compose request is on the wire, from dispatch until it settles -- unlike `composing`, which a
   * reset clears so the new context's UI is not stuck on a spinner.
   *
   * The HubSpot lists are still being created after a reset abandons the reply, so writes and
   * staging are held on THIS. Releasing the hold with `composing` let Stage unlock mid-compose and
   * clone a draft against the audience that compose was about to replace.
   */
  protected readonly composeOnWire = signal(false);
  /** The brief a compose was dispatched with, so its `recorded` result is not read as another brief's. */
  protected readonly composeBriefId = signal('');
  /** The parent's `audienceScope` at the last compose's dispatch -- which SEND it belonged to. */
  private readonly composeScope = signal(0);
  /**
   * Whether the last compose belonged to a different send than the one on screen.
   *
   * A compose WITH a brief is identified by that brief: re-proceeding from Plan resets the parent
   * (bumping its generation) yet resolves the same brief, and its recorded list is still this
   * email's. A compose with NO brief has only the generation: the plan save that follows fills
   * `briefId` for the same send, so comparing ids read that as another email and hid the recovery
   * this send still needs.
   */
  protected readonly composeForOtherSend = computed(() =>
    this.composeBriefId() !== '' ? this.composeBriefId() !== this.briefId() : this.composeScope() !== this.audienceScope()
  );

  /**
   * The confirmed master the last compose created and could NOT record, from either outcome that
   * leaves one: an unrecorded success, or a 502 partial whose attach failed after both lists
   * existed. Set in the one place both report it (`unattached` in `onComposeMaster`), so a new
   * outcome cannot be added that the recovery copy forgets -- reading `composeResult` alone missed
   * the partial, whose master IS in the reuse grid.
   */
  private readonly looseComposedMaster = signal<AudienceComposedList | null>(null);

  /** This send's compose left a master it could not record -- the loose list to reuse. */
  protected readonly looseComposeForThisSend = computed(() => this.looseComposedMaster() !== null && !this.composeForOtherSend());
  /**
   * Names for suppression lists added by "Copy selection" that are not rows of the standard
   * suppression grid. The suppression map stores key -> list id only, and the grid supplies names
   * for its own keys; these keys (`copied:<id>`) have no row there.
   */
  private readonly copiedSuppressionNames = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Set when a project switch abandoned a compose that was already running. The lists may exist
   * in the portal with nothing on screen naming them, so the next compose could duplicate them —
   * the operator has to be told to check HubSpot before trying again.
   */
  protected readonly composeStranded = signal(false);

  /**
   * Dismissed by the OPERATOR, never by a reset.
   *
   * A discovery cannot reconcile an abandoned HubSpot write, so clearing this warning on the
   * next run let it be dismissed implicitly — the operator could return to the original project
   * and compose duplicates having never seen it. It names the project it belongs to so it stays
   * meaningful after a switch, and only an explicit acknowledgement removes it.
   */
  protected readonly strandedProject = signal('');

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
      // `startWith(null)` per slug: switchMap starts the new request, but toSignal keeps the
      // PREVIOUS project's value until the new one emits — so a project that answered
      // `hubspotConfigured: true` left every control enabled for the next project while it was
      // still unverified. Emitting null first makes the gap explicitly unknown, which
      // `degraded` already treats as closed.
      switchMap((slug) =>
        this.campaignService.getAudienceCapabilities(slug).pipe(
          // `tap` BEFORE `catchError`: it runs only on the success path. After it, it would
          // also run on the value catchError emits and immediately clear the flag that arm
          // had just set.
          // Cleared here AND on the switch below: `startWith(null)` makes the new project
          // `degraded` immediately, but this tap only runs once the new request settles — so an
          // outage on A kept the "could not be reached" banner up over B for the whole pending
          // window, including when B is merely unconfigured.
          tap(() => this.capabilitiesFailed.set(false)),
          catchError(() => {
            // Fail CLOSED, but do not claim to know WHY. A failed capabilities call can be a
            // gateway or campaign-service outage just as easily as an unconfigured portal;
            // reporting the latter sends the operator to fix credentials that are fine.
            this.capabilitiesFailed.set(true);
            return of<AudienceBuilderCapabilities>({ hubspotConfigured: false });
          }),
          startWith(null)
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

  /**
   * Upstream's reason the connection is unusable, when it sends one. Preferred over the generic
   * "no credentials configured" copy: that sentence is only true for one of the two states
   * `hubspotConfigured: false` covers, and it sends an administrator to fix credentials that
   * may already exist.
   */
  /**
   * Selection controls are locked once a compose starts, not only when degraded. Compose
   * snapshots the list ids at request time, so a selection edited during or after the write
   * leaves the page implying that the rows now shown produced the master — when it was built
   * from an earlier set. `composeAttempted` (not `composing`) because the mismatch outlives the
   * request: the result banner is still on screen afterwards.
   */
  protected readonly selectionLocked = computed(() => this.degraded() || this.composeAttempted());

  /**
   * The event url a compose was attempted for, exposed so the template can disable Discover on a
   * re-run of it. A disabled button is better than a silent no-op: the refusal is visible, and
   * the composed result and its HubSpot link stay on screen beside it rather than being wiped.
   */
  protected readonly composedFor = this.composedEventUrl.asReadonly();

  protected readonly degradedDetail = computed(() => this.capabilities()?.detail?.trim() || null);

  protected readonly inclusionIds = computed<ReadonlySet<string>>(() => new Set(this.inclusion().keys()));
  /** Ticked row KEYS — what the suppression grid checks against. */
  protected readonly suppressionKeys = computed<ReadonlySet<string>>(() => new Set(this.suppression().keys()));

  /** The resolved list ids behind those rows, de-duplicated. */
  protected readonly suppressionListIds = computed<ReadonlySet<string>>(() => new Set(this.suppression().values()));

  /** Every selected id, so a child can grey out an Add button for a list already in either set. */
  protected readonly selectedIds = computed<ReadonlySet<string>>(() => new Set([...this.inclusion().keys(), ...this.suppression().values()]));

  protected readonly inclusionEntries = computed(() => [...this.inclusion()].map(([listId, name]) => ({ listId, name })));

  /** Lists marked as exclusions from steps 2, 4 and 5, so each child can show its Exclude as on. */
  protected readonly exclusionIds = computed<ReadonlySet<string>>(() => new Set(this.exclusion().keys()));

  /**
   * At least one suppression list must stay ticked in step 3 before anything is composed or
   * attached. Sending with no suppression at all is the compliance failure that step exists to
   * prevent, so it is a hard gate rather than the amber hint it used to be.
   */
  protected readonly suppressionMissing = computed(() => this.suppressionListIds().size === 0);

  /**
   * The exclusions actually sent: ticked suppression rows plus lists marked Exclude, minus inclusion.
   *
   * A list ticked on both sides is a contradiction the operator cannot see resolved anywhere else,
   * and HubSpot would apply both filters and return nobody. Inclusion wins because it is the
   * explicit intent — the suppression tick is a recommendation this component made. (An Exclude
   * mark cannot collide with inclusion: the two are kept mutually exclusive when set.)
   */
  protected readonly excludeIds = computed(() =>
    [...new Set([...this.suppressionListIds(), ...this.exclusion().keys()])].filter((id) => !this.inclusion().has(id))
  );

  /**
   * Lists ticked on BOTH sides. Resolving this silently was the defect: `excludeIds` drops the
   * exclusion and both checkboxes stay ticked, so the panel states a GDPR or opt-out list will
   * be applied while the request omits it — and the send reaches contacts the operator believes
   * were suppressed. Surfaced and blocking instead, because which side should win is the
   * operator's call, not a rule this component can make on their behalf.
   */
  protected readonly conflictingIds = computed(() => [...this.suppressionListIds()].filter((id) => this.inclusion().has(id)));

  protected readonly conflictNames = computed(() =>
    // A conflict is identified by LIST id, and `suppression` is keyed by row key — so the name
    // comes from `inclusion`, which is keyed by list id. Looking it up in `suppression` first
    // would always miss and only appear to work because the fallback holds the same list.
    this.conflictingIds()
      .map((id) => this.inclusion().get(id) ?? id)
      .sort((a, b) => a.localeCompare(b))
  );

  /**
   * The count label as a COMPUTED rather than a template method call.
   *
   * `countLabel` is pure, but calling it from the template re-ran it on every change-detection
   * pass (`frontend-checklist.md` §4). The formatting logic stays in the method — which the
   * tests drive directly — and this just memoises it against the signal it reads.
   */
  protected readonly previewCountLabel = computed(() => {
    const count = this.previewCount();
    return count === null ? '' : this.countLabel(count);
  });

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
   * Direct attach needs a brief to attach to and a usable HubSpot connection -- and no OTHER
   * write to this brief's audience already in flight.
   *
   * Compose and attach both record an audience against the same brief, and neither used to know
   * about the other: `canAttach` ignored `composing()` and `canCompose` ignored `attachingId()`.
   * Started together, the displayed selection and the RECORDED audience are decided by response
   * arrival order, so the operator can be looking at one list while the send points at another.
   *
   * Serialized rather than reconciled: there is no correct merge of two audiences for one brief,
   * and the second write is a real HubSpot record either way.
   */
  protected readonly canAttach = computed(
    () =>
      this.briefId() !== '' &&
      !this.degraded() &&
      !this.audienceUnknown() &&
      !this.stagingInFlight() &&
      !this.composing() &&
      !this.composeOnWire() &&
      !this.attachInFlight()
  );

  /**
   * Whether the brief's existing audience is UNKNOWN -- its read is in flight, failed, or never ran.
   *
   * Every write to the brief's audience gates on this, not only compose. Gating compose alone left
   * attach and both reuse paths open, and each of those also records a send audience against the
   * brief -- on top of one the operator cannot see. `canAttach` carries it, so every path built on
   * that inherits it rather than having to remember it.
   */
  protected readonly audienceUnknown = computed(() => this.audienceReadFailed() || this.audienceReadPending() || this.audienceReadUnavailable());

  /**
   * The id of the existing audience the operator has explicitly chosen to REPLACE, if any.
   *
   * Keyed by audience id rather than a boolean, so the choice cannot outlive the audience it was
   * made about: a different brief, or a newer row for this one, needs its own decision.
   */
  protected readonly replaceRequestedFor = signal<string | null>(null);

  /**
   * The brief's existing audience, when it should be shown and should block compose.
   *
   * Not compared against `briefId`. The parent scopes `existingAudience` to the brief it is
   * addressing -- a brief switch clears it and every read is generation-guarded -- while `briefId`
   * is deliberately EMPTY for an unapproved restore. Matching the two let exactly that restore
   * through: a known audience, no prompt, and compose minting a second HubSpot master.
   */
  protected readonly blockingAudience = computed<CampaignAudience | null>(() => {
    const existing = this.existingAudience();
    // Not when it IS this panel's own write: the result block already states what the email sends
    // to, and offering "replace" there rendered a button that could not work beside a banner it
    // contradicted. Matched by list rather than by "a write happened" -- an audience that points
    // ELSEWHERE (one restored after this panel composed something unrecorded) must still be shown.
    if (existing === null || (existing.platformMasterListId !== undefined && existing.platformMasterListId === this.attachedListId())) {
      return null;
    }
    return this.replaceRequestedFor() === existing.id ? null : existing;
  });

  /**
   * Whether "Compose a replacement" can actually replace anything.
   *
   * Not while `briefId` is empty (an unapproved restore, before its re-approval lands): the compose
   * would go out with no brief, come back unrecorded, and leave the restored audience as the send
   * list -- the duplicate the replace prompt exists to prevent. Nor once this panel has composed:
   * `composeAttempted` blocks a second compose, so the button could not do what it says.
   */
  protected readonly canReplaceExisting = computed(() => this.briefId() !== '' && !this.composeAttempted());

  /** The list currently recorded as this email's send list by THIS panel, if any. */
  protected readonly attachedListId = computed(() => {
    const attached = this.attachResult();
    const composed = this.composeResult();
    // A compose is recorded against the brief it was DISPATCHED with. After the parent moves to
    // another brief the lists still exist, but they are not that brief's send list.
    const composedForThisBrief = composed?.recorded === true && this.composeBriefId() === this.briefId();

    // The LATER write wins, not attach unconditionally. Preferring the attach result meant that
    // after attaching and then composing, the panel showed the attached list while the brief
    // recorded the composed one. The two writes are now serialized, so "later" is unambiguous --
    // `lastWriteWasAttach` is set by whichever handler recorded last.
    if (attached && (!composedForThisBrief || this.lastWriteWasAttach())) {
      return attached.master.listId;
    }
    return composedForThisBrief && composed ? composed.master.listId : (attached?.master.listId ?? null);
  });

  /**
   * The exclusions behind the current attachment, so a prior send can be matched on its FULL
   * selection rather than its master alone.
   *
   * Two sends can share master 501 with different exclusions, and comparing masters alone marked
   * both "Same lists used for this email" -- disabling both reuse buttons and leaving the operator
   * unable to pick the other send's suppressions.
   *
   * Read off the SAME result `attachedListId` reads, and off the attach arm only. Recording what
   * was SENT at dispatch time let a failed attach leave the master from the successful write beside
   * the exclusions from the failed one, describing a selection the brief does not have -- which is
   * the mismatch this is here to remove. Upstream returns what it persisted, so a successful attach
   * is the only thing that can move either half, and the two cannot disagree.
   */
  protected readonly attachedExclusions = computed<readonly string[]>(() => {
    const attached = this.attachResult();
    if (attached === null || this.attachedListId() !== attached.master.listId) {
      return [];
    }
    const includes = new Set(this.attachedIncludeIds());
    return [...new Set(attached.suppressionListIds)].filter((id) => !includes.has(id));
  });

  /**
   * Every list the recorded audience sends to, so a prior send with several include lists can be
   * matched on all of them. An attach of several lists records them in `includeListIds`; a single
   * master (attached or composed) is just that one list.
   */
  protected readonly attachedIncludeIds = computed<readonly string[]>(() => {
    const listId = this.attachedListId();
    if (listId === null) {
      return [];
    }
    const attached = this.attachResult();
    if (attached !== null && attached.master.listId === listId) {
      const includes = attached.audience.includeListIds ?? [];
      return includes.length > 0 ? includes : [listId];
    }
    return [listId];
  });

  /** Names for the recorded include lists, for the attach result banner. */
  protected readonly attachedIncludeNames = computed(() => {
    const names = this.listNameIndex();
    return this.attachedIncludeIds().map((listId) => names.get(listId) ?? `List ${listId}`);
  });

  /**
   * The master recorded as this email's send list, but only while the RECORD still matches what the
   * operator is now asking for.
   *
   * Matching on the master id alone kept "Use for this email" disabled after the step-3 ticks
   * changed: the button read "Used for this email" while the brief still held the OLD exclusions,
   * and there was no way to record the new ones. An attach records its exclusions, so it is matched
   * on both halves. A compose records a combined suppression LIST rather than the ticked ids, so
   * its exclusions cannot be compared to the ticks and it is matched on the master alone.
   */
  protected readonly attachedMasterId = computed<string | null>(() => {
    const listId = this.attachedListId();
    const attached = this.attachResult();
    if (listId === null || attached === null || attached.master.listId !== listId) {
      return listId;
    }
    // Several lists attached directly: no single master is "the" send list, so none reads as used.
    if (this.attachedIncludeIds().length > 1) {
      return null;
    }
    const recorded = new Set(this.attachedExclusions());
    const requested = new Set(this.excludeIds().filter((id) => id !== listId));
    return recorded.size === requested.size && [...requested].every((id) => recorded.has(id)) ? listId : null;
  });

  /** Every list size this panel has seen, so the summary can total the selection's known reach. */
  private readonly sizeIndex = computed(() => {
    const sizes = new Map<string, number>();
    const note = (listId: string, size?: number) => {
      if (size !== undefined) {
        sizes.set(listId, size);
      }
    };
    this.discoveredLists().forEach((list) => note(list.listId, list.size));
    this.reuseMasterLists().forEach((list) => note(list.listId, list.size));
    this.suppressionLists().forEach((list) => note(list.listId, list.size));
    this.lastSentEmails().forEach((email) => [...email.includedLists, ...email.suppressionLists].forEach((list) => note(list.listId, list.size)));
    this.searchResults().forEach((list) => note(list.listId, list.size));
    return sizes;
  });

  /** Every HubSpot link this panel has seen, so selection chips can open the list they name. */
  private readonly urlIndex = computed(() => {
    const urls = new Map<string, string>();
    const note = (listId: string, url?: string) => {
      if (url) {
        urls.set(listId, url);
      }
    };
    this.discoveredLists().forEach((list) => note(list.listId, list.hubspotUrl));
    this.reuseMasterLists().forEach((list) => note(list.listId, list.hubspotUrl));
    this.suppressionLists().forEach((list) => note(list.listId, list.hubspotUrl));
    this.lastSentEmails().forEach((email) => [...email.includedLists, ...email.suppressionLists].forEach((list) => note(list.listId, list.hubspotUrl)));
    this.searchResults().forEach((list) => note(list.listId, list.hubspotUrl));
    return urls;
  });

  /** Every list name this panel has seen, so a recorded attach can name the lists it sends to. */
  private readonly listNameIndex = computed(() => {
    const names = new Map<string, string>();
    const note = (listId: string, name?: string) => {
      if (name) {
        names.set(listId, name);
      }
    };
    this.discoveredLists().forEach((list) => note(list.listId, list.name));
    this.reuseMasterLists().forEach((list) => note(list.listId, list.name));
    this.lastSentEmails().forEach((email) => [...email.includedLists, ...email.suppressionLists].forEach((list) => note(list.listId, list.name)));
    this.searchResults().forEach((list) => note(list.listId, list.name));
    this.inclusion().forEach((name, listId) => note(listId, name));
    return names;
  });

  /** Inclusion chips decorated with a link and size where one is known. */
  protected readonly inclusionChips = computed(() => {
    const urls = this.urlIndex();
    const sizes = this.sizeIndex();
    return this.inclusionEntries().map((entry) => {
      const size = sizes.get(entry.listId);
      return {
        ...entry,
        hubspotUrl: urls.get(entry.listId) ?? '',
        sizeText: size === undefined ? '' : size.toLocaleString('en-US'),
      };
    });
  });

  /** Excluded lists with display names, for the review step — the grid alone cannot name copied ones. */
  protected readonly suppressionEntries = computed(() => {
    const gridNames = new Map(this.suppressionLists().map((row) => [row.key, row.name || row.label]));
    const copied = this.copiedSuppressionNames();
    return [...this.suppression()]
      .filter(([, listId]) => !this.inclusion().has(listId))
      .map(([key, listId]) => ({
        key,
        listId,
        name: gridNames.get(key) ?? copied.get(listId) ?? `List ${listId}`,
        hubspotUrl: this.urlIndex().get(listId) ?? '',
      }));
  });

  /** Lists marked Exclude in steps 2, 4 and 5, for their own chip group in the review step. */
  protected readonly exclusionChips = computed(() => {
    const urls = this.urlIndex();
    const sizes = this.sizeIndex();
    return [...this.exclusion()].map(([listId, name]) => {
      const size = sizes.get(listId);
      return {
        listId,
        name,
        hubspotUrl: urls.get(listId) ?? '',
        sizeText: size === undefined ? '' : size.toLocaleString('en-US'),
      };
    });
  });

  /**
   * Headline numbers for the summary strip.
   *
   * The sum is an upper bound only when EVERY included list reported a size: overlap can only make
   * the union smaller. With any size withheld, the missing list can make the union arbitrarily
   * larger, so a partial sum is no bound at all and is shown without the `≤`, flagged as partial.
   * The same reasoning as `reportedMembershipsLabel` in the last-sent card.
   */
  protected readonly summary = computed(() => {
    const sizes = this.sizeIndex();
    const included = [...this.inclusion().keys()];
    const known = included.filter((id) => sizes.has(id));
    const reach = known.reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0);
    let reachText = '—';
    if (known.length > 0) {
      const figure = reach.toLocaleString('en-US');
      reachText = known.length === included.length ? `≤ ${figure}` : figure;
    }
    return {
      included: included.length,
      excluded: this.excludeIds().length,
      reachText,
      reachPartial: known.length > 0 && known.length < included.length,
      reachKnownCount: known.length,
    };
  });

  /**
   * Reusing EXISTING lists needs the same settled suppression read that composing does, and at
   * least one suppression ticked.
   *
   * Every attach path -- a master list, a past send's lists, or the step-6 selection -- sends the
   * step-3 ticks along with it, so all of them share this gate. `canUseSelectionDirectly` adds only
   * that there must be something selected.
   */
  protected readonly canUseExistingMaster = computed(
    () =>
      this.canAttach() &&
      !this.suppressionLoading() &&
      !this.suppressionFailed() &&
      !this.suppressionMissing() &&
      // The same conflict gate compose carries. Attach submits `excludeIds()`, which DROPS a list
      // ticked on both sides -- so the attachment silently lost a suppression the panel still
      // showed as applied.
      this.conflictingIds().length === 0
  );

  /**
   * The selected lists can be sent to as they are, with no master list combining them: a HubSpot
   * email takes several include lists, so a master is only needed when the operator wants one list
   * to reuse later.
   *
   * Gated on a settled suppression fetch, for the same fail-closed reason as `canCompose`: the
   * exclusions this attach records are the ones ticked from that fetch, so attaching while it is in
   * flight or failed records a send with no GDPR/CASL suppression.
   */
  protected readonly canUseSelectionDirectly = computed(() => this.canUseExistingMaster() && this.inclusion().size > 0 && this.listLimitMessage() === '');

  /**
   * Why direct use is off when the only obstacle is the selection's size; '' otherwise. The BFF
   * refuses more than AUDIENCE_ATTACH_MAX_LIST_IDS include ids, so offering the action past that
   * only produced a failed attach.
   */
  protected readonly directUseLimitMessage = computed(() => this.listLimitMessage());

  /**
   * Why a compose or a direct attach of the current selection would be refused by the BFF's
   * per-request cap: more than AUDIENCE_ATTACH_MAX_LIST_IDS lists selected, or excluded. '' when
   * within it. Both actions send these arrays, so both are gated on it; telling the operator to
   * compose instead steered them into a compose that failed the same way and then locked.
   */
  protected readonly listLimitMessage = computed(() => {
    if (this.inclusion().size > AUDIENCE_ATTACH_MAX_LIST_IDS) {
      return `Select at most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists. One request can carry at most ${AUDIENCE_ATTACH_MAX_LIST_IDS}.`;
    }
    if (this.excludeIds().length > AUDIENCE_ATTACH_MAX_LIST_IDS) {
      return `Exclude at most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists. One request can carry at most ${AUDIENCE_ATTACH_MAX_LIST_IDS}.`;
    }
    return '';
  });

  /**
   * Why "Use for this email" cannot run, in the operator's terms. Empty when it can.
   *
   * The brief half replaces the old fixed "Save the plan on the Plan tab first" text, which was
   * wrong in every case it was shown: the parent saves the brief itself when this tab opens.
   */
  protected readonly attachUnavailableMessage = computed(() => {
    if (this.briefId() === '') {
      return this.briefStateMessage();
    }
    if (this.suppressionLoading()) {
      return 'The suppression lists are still loading in step 3.';
    }
    if (this.suppressionFailed()) {
      return 'The suppression lists in step 3 could not be loaded. Reload them before attaching.';
    }
    if (this.suppressionMissing()) {
      // Nothing to tick is a different problem from nothing ticked: telling the operator to select a
      // list when none resolves in this portal gave them an instruction they could not follow.
      return this.suppressionLists().some((list) => list.listId !== '')
        ? 'Select at least one suppression list in step 3 first. Every send must keep at least one suppression list.'
        : 'No suppression list resolves in this HubSpot portal, and every send must keep at least one. Ask a HubSpot admin to create the hygiene lists.';
    }
    if (this.conflictingIds().length > 0) {
      return 'A list is ticked both to send to and to suppress. Untick one side first.';
    }
    return '';
  });

  /** The brief half of `attachUnavailableMessage`, also shown beside the step-6 actions. */
  protected readonly briefStateMessage = computed(() => {
    switch (this.briefState()) {
      case 'resolving':
        return 'Saving the plan for this email… Lists can be attached as soon as it is saved.';
      case 'unapproved':
        return 'The plan was saved but is not approved yet. Approve it on the Plan tab, then come back to attach lists.';
      case 'unopened':
        return 'This email already has a saved plan from an earlier session that was not opened here, so it was not saved over. Open it from the Plan tab: pick this email type, then re-enter the event URL to restore it. Lists can be attached once it is loaded.';
      case 'failed':
        return (
          this.briefSaveMessage() || 'Saving the plan for this email failed, so there is nothing to attach lists to yet. Use Retry at the top of this tab.'
        );
      default:
        return 'This email has no saved plan yet. Fill in the Plan tab and continue to save it, then come back to attach lists.';
    }
  });

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
      // An audience that could not be READ -- or has not been read YET -- is not an audience that
      // is absent. Composing on top of one creates a duplicate master list.
      !this.audienceUnknown() &&
      // A KNOWN existing audience blocks too, until replacing it is an explicit choice. Compose is
      // the one write here that creates something, so it is the one that must not run by default.
      this.blockingAudience() === null &&
      // The other half of the serialization above: an attach in flight is a write to this same
      // brief's audience, and the later reply would decide the record. `attachInFlight`, not the
      // spinner: the spinner is cleared on a brief switch while the request is still running.
      // Likewise a compose a reset abandoned is still being created upstream.
      !this.attachInFlight() &&
      !this.composeOnWire() &&
      // Not while the parent is staging a send against this brief's audience.
      !this.stagingInFlight() &&
      !this.suppressionFailed() &&
      !this.suppressionLoading() &&
      !this.composeAttempted() &&
      // A stranded compose in THIS project is unreconciled work: lists may already exist under
      // a name the next compose would reuse. The warning alone did not stop it, so an operator
      // could compose without ever acknowledging it. Scoped to the affected project — composing
      // in an unrelated one is unaffected.
      this.strandedProject() !== this.projectSlug() &&
      this.conflictingIds().length === 0 &&
      // At least one suppression list, always. See `suppressionMissing`.
      !this.suppressionMissing() &&
      // Within the BFF's per-request cap, or the compose is refused and then locks. See `listLimitMessage`.
      this.listLimitMessage() === '' &&
      this.inclusion().size > 0
  );

  public constructor() {
    // The last NON-empty event key (see `eventKey`); used by the reset below. Declared here
    // because a project switch must clear it too: carried over, project A's last event made a
    // brief for project B's event read as a CHANGE, wiping work the operator started by hand in B.
    let lastEventKey = '';
    let lastAdvertisedUrl = '';

    // A project switch must drop the previous portal's audience state, not just refetch
    // capabilities. The campaigns component stays mounted across `activeFoundationSlug`
    // changes, so discovered lists, ticks, preview counts and compose banners all survived —
    // and HubSpot list ids are numeric and portal-scoped, so an id ticked in portal A can
    // collide with an unrelated list in portal B and compose it.
    //
    // `resetRunState` already invalidates in-flight replies via the run generation, so a
    // request issued for the old project cannot write after this either.
    toObservable(this.projectSlug)
      .pipe(distinctUntilChanged(), pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([previousProject]) => {
        this.resetForNewContext(previousProject);
        // Cleared: the parent keeps its brief across a foundation switch, but that brief is the OLD
        // project's event, so remembering its key compared the new project's first brief against it
        // and wiped work discovered here for that very event. Work in the new project is exploratory
        // until its first brief arrives, and the first-brief rule keeps it only when it was discovered
        // for the URL that brief advertises -- a brief with no URL, or another URL, starts over.
        lastEventKey = '';
        lastAdvertisedUrl = '';
        this.capabilitiesFailed.set(false);
        // reset(), not setValue(''): the dirty flag is project-scoped state too. setValue leaves
        // the control dirty, and the `initialEventUrl` seed below only fires while it is pristine
        // — so typing in project A would silently suppress project B's advertised brief URL.
        this.eventUrlControl.reset('', { emitEvent: false });
      });

    // An attach result or error describes the brief it was made for. The parent swaps briefs
    // under a mounted panel, so without this the previous brief's "attached" banner and list id
    // read as the new brief's. Compose state is left alone: those lists exist regardless, and
    // `composeAttempted` must keep blocking a duplicate compose.
    toObservable(this.briefId)
      .pipe(distinctUntilChanged(), pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.attachingId.set(null);
        this.attachResult.set(null);
        this.attachError.set(null);
      });

    toObservable(this.initialEventUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((url) => {
        // Seed only; never overwrite a URL the operator has already typed.
        if (url && this.eventUrlControl.pristine) {
          this.eventUrlControl.setValue(url);
        }
      });

    // A DIFFERENT event's brief arriving under this mounted panel starts it over, as a project
    // switch does. The parent hands Plan's next event to the same component, and the `briefId`
    // reset above clears only the attach state -- so event A's discovery, ticks and identity
    // survived, and a compose then sent A's lists (and A's event name into the list names) with
    // B's brief id. The same event re-proceeded, or another email stage for it, keeps the operator's
    // selection (how the event is identified is below).
    //
    // An EMPTY URL means "no brief right now", not "a different event", so it is skipped and the
    // comparison is against the last NON-empty one. Every stage change and every return to Plan
    // clears the brief first, so a plain previous/next pair saw A -> '' and wiped the same event's
    // work. From no event at all is not a change either: a brief arriving for an exploratory
    // session the operator started by hand is the same work.
    //
    // A discovery still STREAMING counts as work too: `hasDiscovered` turns true only on the final
    // frame, while `identity` and the lists land earlier, so B's brief arriving mid-stream let A's
    // frames finish under it.
    //
    // The work's event is the URL it was DISCOVERED for when the operator edited the field, and the
    // advertised URL only while it is pristine. Comparing advertised URLs alone missed an edit:
    // advertised A, discovered B by hand, A handed back -- "A -> A" -- and B's lists were composed
    // with A's brief.
    //
    // The EVENT is identified by `eventKey` (slug, then name, then URL), not by URL alone: two events
    // with no registration URL, or sharing one, otherwise looked identical.
    //
    // FAIL-SAFE where these disagree: a different event KEY always starts over, even when the
    // operator had discovered the incoming event's URL by hand. Two events can share a URL, and the
    // cost of a wrong guess is A's lists composed with B's brief; the cost of the reset is re-running
    // a discovery. Within the same key, a corrected advertised URL, or edited work discovered for a
    // different URL, also starts over. Only the FIRST brief after exploratory work keeps it, when
    // that work was discovered for the URL the brief advertises.
    toObservable(computed(() => ({ key: this.eventKey().trim().toLowerCase() || this.initialEventUrl(), url: this.initialEventUrl() })))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ key: nextKey, url: advertised }) => {
        if (nextKey === '') {
          return;
        }
        const previousKey = lastEventKey;
        const previousUrl = lastAdvertisedUrl;
        lastEventKey = nextKey;
        lastAdvertisedUrl = advertised;
        const differentEvent = this.isDifferentEvent(previousKey, nextKey, previousUrl, advertised);
        if (!(this.hasDiscovered() || this.discovering())) {
          // No discovery yet, but a TYPED URL is work too: the seed below never overwrites a dirty
          // field, so a URL typed for event B survived into event C's brief and the next discovery
          // composed B's lists with C's brief id. Reseed it; nothing else exists to reset.
          // Only for a different EVENT: a later update to the same event's brief must not clobber
          // what the operator typed over the seed.
          if (previousKey !== '' && previousKey !== nextKey && this.eventUrlControl.dirty) {
            this.eventUrlControl.reset(advertised, { emitEvent: false });
          }
          return;
        }
        if (!differentEvent) {
          return;
        }
        this.resetForNewContext(this.projectSlug());
        this.eventUrlControl.reset(advertised, { emitEvent: false });
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
  /**
   * The only way the stranded-compose warning clears: an explicit acknowledgement -- and only once
   * the abandoned request has SETTLED. While it is still on the wire the lists may not exist yet,
   * so "I have checked HubSpot" could be answered truthfully and then be wrong a moment later, and
   * clearing the marker re-permitted a compose that duplicates them.
   */
  protected onDismissStranded(): void {
    if (this.composeOnWire()) {
      return;
    }
    this.composeStranded.set(false);
    this.strandedProject.set('');
  }

  protected onDiscover(): void {
    const eventUrl = this.eventUrlControl.value.trim();
    // Not while an attach is on the wire, either. Discovery resets the run, which discards that
    // attach's reply -- so its outcome, success or error, would never be shown for the brief it was
    // recorded against.
    if (this.degraded() || this.discovering() || this.attachInFlight() || eventUrl.length === 0) {
      return;
    }
    // Refused HERE rather than re-locking after the reset. `composeAttempted` is the
    // duplicate-prevention latch and resetRunState clears it, so a same-url rerun used to
    // rebuild an identical selection with compose live again. Restoring the latch afterwards
    // was worse: it re-locked grids whose contents, result banner and HubSpot link the reset
    // had already wiped, leaving untickable lists and a disabled Compose with no explanation.
    // Returning early keeps the composed result — and its link — on screen, which is the thing
    // the operator actually needs. A different url is a different event and still starts over.
    if (this.composeAttempted() && eventUrl === this.composedEventUrl()) {
      return;
    }

    // Reset the PREVIOUS run first, then mark the new one active. The other order left
    // resetRunState clearing the `discovering` it had just been set to — so the spinner never
    // appeared and the Discover button stayed live, letting a second click launch an
    // overlapping SSE request against the same panel.
    this.resetRunState();
    this.discoveredEventUrl.set(eventUrl);
    this.discovering.set(true);
    this.discoveryError.set(null);
    this.progressMessage.set('Starting discovery...');
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
          this.discoveryError.set(serverAuthoredMessage(httpErr, 'Audience discovery failed'));
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
    this.dropExclusion(listId);
    this.toggle(this.inclusion, listId, list?.name ?? listId);
  }

  /** Step 2's Exclude: marks (or unmarks) a discovered list as an exclusion. */
  protected onToggleExclude(listId: string): void {
    const list = this.discoveredLists().find((candidate) => candidate.listId === listId);
    this.onExcludeList({ listId, name: list?.name ?? listId });
  }

  /**
   * Marks a list as an exclusion -- its contacts are kept off the send -- or unmarks it if it is
   * already one. Marking it removes it from the included lists: a list cannot be both.
   */
  protected onExcludeList(list: AudienceListRef): void {
    if (this.selectionLocked() || list.listId === '') {
      return;
    }
    const next = new Map(this.exclusion());
    if (next.has(list.listId)) {
      next.delete(list.listId);
    } else {
      next.set(list.listId, list.name);
      if (this.inclusion().has(list.listId)) {
        const inclusion = new Map(this.inclusion());
        inclusion.delete(list.listId);
        this.inclusion.set(inclusion);
      }
    }
    this.exclusion.set(next);
    this.invalidatePreview();
  }

  protected onRemoveExclusion(listId: string): void {
    if (this.selectionLocked()) {
      return;
    }
    this.dropExclusion(listId);
    this.invalidatePreview();
  }

  protected onToggleSuppression(key: string): void {
    const list = this.suppressionLists().find((candidate) => candidate.key === key);
    // Stored key -> resolved list id: the key is the selection identity, the id is what compose
    // and the conflict check need. An unresolved row cannot reach here (the grid refuses to emit
    // for an empty list id), so `listId` is always a real id by the time it is stored.
    if (list !== undefined) {
      this.toggle(this.suppression, key, list.listId);
    }
  }

  protected onAddListBrief(list: AudienceListBrief): void {
    this.add(list.listId, list.name);
  }

  protected onAddMasterList(list: AudienceMasterListBrief): void {
    this.add(list.listId, list.name);
  }

  /**
   * Ticks a past send's whole selection: every resolvable included list, and every suppression
   * list. A suppression list that is also a standard grid row is ticked THROUGH its grid key so
   * the grid shows it ticked; any other is stored under a `copied:` key with its name kept here.
   */
  protected onCopySelection(email: AudienceLastSentEmail): void {
    if (this.selectionLocked()) {
      return;
    }
    const inclusion = new Map(this.inclusion());
    email.includedLists.filter((list) => !list.missing).forEach((list) => inclusion.set(list.listId, list.name));
    const suppression = new Map(this.suppression());
    const copiedNames = new Map(this.copiedSuppressionNames());
    const alreadyExcluded = new Set(suppression.values());
    email.suppressionLists
      .filter((list) => !list.missing && !alreadyExcluded.has(list.listId))
      .forEach((list) => {
        const gridRow = this.suppressionLists().find((row) => row.listId === list.listId);
        if (gridRow) {
          suppression.set(gridRow.key, list.listId);
        } else {
          suppression.set(`copied:${list.listId}`, list.listId);
          copiedNames.set(list.listId, list.name);
        }
      });
    this.inclusion.set(inclusion);
    [...inclusion.keys()].forEach((listId) => this.dropExclusion(listId));
    this.suppression.set(suppression);
    this.copiedSuppressionNames.set(copiedNames);
    this.invalidatePreview();
  }

  /**
   * Attaches a past send's include lists directly -- however many it had, with no master list built
   * -- excluding that send's suppression lists AND whatever is ticked or marked Exclude here, so the
   * mandatory step-3 suppression always applies.
   */
  protected onUseSendLists(email: AudienceLastSentEmail): void {
    const includes = email.includedLists.filter((list) => !list.missing).map((list) => list.listId);
    if (includes.length === 0 || !this.canUseExistingMaster()) {
      return;
    }
    this.attachExisting(
      email.emailId,
      includes,
      email.suppressionLists.map((list) => list.listId),
      `Same lists as the earlier send "${email.emailName}"`
    );
  }

  /**
   * Attaches an existing master list, with whatever suppression is ticked in step 3.
   *
   * Gated on a SETTLED suppression read, like `canUseSelectionDirectly`. This path submits
   * `excludeIds()` -- the operator's ticked suppressions -- and while that lookup is pending or
   * failed the set is empty for a reason that has nothing to do with the operator's intent. It
   * would record a send audience with NO exclusions before anyone could review them.
   *
   * Prior-send reuse is gated the same way now: it adds the ticked suppressions to the earlier
   * send's own, so at least one must be ticked and the lookup must have settled.
   */
  protected onUseMasterList(list: AudienceMasterListBrief): void {
    if (!this.canUseExistingMaster()) {
      return;
    }
    this.attachExisting(list.listId, [list.listId], [], '');
  }

  /** Sends to every selected list directly, with the ticked suppression — no master list built. */
  protected onUseSelectionDirectly(): void {
    if (!this.canUseSelectionDirectly()) {
      return;
    }
    const entries = this.inclusionEntries();
    const names = entries.map((entry) => entry.name);
    // Bounded to what the BFF stores: a long run of list names otherwise failed the whole attach.
    const full = entries.length === 1 ? '' : `${entries.length} lists: ${names.join(', ')}`;
    const summary = full.length > AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH ? `${full.slice(0, AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH - 1)}…` : full;
    this.attachExisting(
      'selection',
      entries.map((entry) => entry.listId),
      [],
      summary
    );
  }

  protected onRemoveSuppression(key: string): void {
    if (this.selectionLocked()) {
      return;
    }
    const next = new Map(this.suppression());
    next.delete(key);
    this.suppression.set(next);
    this.invalidatePreview();
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
    // Bump first, so the early return below also invalidates anything in flight: clearing the
    // input must not be repopulated by a reply to the query the operator just deleted.
    const seq = ++this.searchSeq;
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
          if (run !== this.runGeneration || seq !== this.searchSeq) {
            return;
          }
          this.searchResults.set(results);
          this.searching.set(false);
        },
        error: () => {
          // Guarded like the success arm above. The asymmetry was the gap: a project switch
          // mid-request let a stale ERROR clear the new run's results.
          if (run !== this.runGeneration || seq !== this.searchSeq) {
            return;
          }
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
    // The grids stay editable while a preview is in flight (`[disabled]` is `degraded()` only —
    // `previewing()` gates the button, not the selection), so the count must be attributed to the
    // selection it was actually computed from. `invalidatePreview()` bumps this on every edit.
    const seq = ++this.previewSeq;
    this.previewError.set(null);
    this.campaignService
      .previewAudienceCount(this.projectSlug(), { listIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (count) => {
          if (run !== this.runGeneration || seq !== this.previewSeq) {
            return;
          }
          this.previewCount.set(count);
          this.previewing.set(false);
        },
        error: (httpErr: HttpErrorResponse) => {
          // Guarded like the success arm above — a stale failure from the previous run must
          // not blame the new one, nor clear its in-flight spinner.
          if (run !== this.runGeneration || seq !== this.previewSeq) {
            return;
          }
          this.previewError.set(serverAuthoredMessage(httpErr, 'Failed to preview the audience size'));
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
    this.composeOnWire.set(true);
    this.composeAttempted.set(true);
    this.composedEventUrl.set(this.eventUrlControl.value.trim());
    const run = this.runGeneration;
    this.composeError.set(null);
    this.composePartial.set(null);
    const dispatchBriefId = this.briefId();
    const dispatchProject = this.projectSlug();
    const dispatchScope = this.audienceScope();
    this.composeBriefId.set(dispatchBriefId);
    this.composeScope.set(dispatchScope);
    this.looseComposedMaster.set(null);
    // Scoped to the dispatch, like `briefId` below: the parent files the orphan warning by these.
    const unattached = (master: AudienceComposedList): void => {
      this.looseComposedMaster.set(master);
      this.rememberComposedMaster(master);
      this.reportUnattached(master, dispatchBriefId, dispatchProject, dispatchScope);
    };

    this.campaignService
      .composeAudienceMaster(this.projectSlug(), {
        listIds: [...this.inclusion().keys()],
        excludeListIds: this.excludeIds(),
        eventUrl: this.eventUrlControl.value.trim() || undefined,
        brandShort: event?.brandShort,
        eventName: event?.eventName,
        eventDates: event?.eventDates,
        // Read at DISPATCH, not in the reply arm. The reply arm runs after a network round trip,
        // by which point the parent may have moved to another brief -- and the attach upstream was
        // made against whatever was sent here, so this is the only value that describes what
        // actually happened.
        briefId: dispatchBriefId || undefined,
      })
      // Released when the REQUEST settles, whatever the run generation says about its reply.
      .pipe(
        finalize(() => this.composeOnWire.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          // A stale reply is still REPORTED to the parent when the project is unchanged: recorded, so
          // the parent shows what upstream now resolves; or unrecorded, so its per-brief "unattached
          // list" warning is filed -- the operator's only route back to a real, billed list. Both are
          // scoped by the dispatch, not by what is on screen. It is not added to THIS run's reuse
          // grid, which now belongs to another event.
          if (run !== this.runGeneration) {
            if (dispatchProject === this.projectSlug()) {
              if (result.recorded && result.audience) {
                this.audienceAttached.emit(result.audience);
              } else {
                this.reportUnattached(result.master, dispatchBriefId, dispatchProject, dispatchScope);
              }
            }
            return;
          }
          this.composeResult.set(result);
          // This compose recorded after any earlier attach; see `attachedListId`.
          this.lastWriteWasAttach.set(false);
          this.composing.set(false);

          // Both this emission and the stale one above rely on the parent's `onAudienceComposed`,
          // which accepts a row only when `audience.briefId` is the brief it is addressing now.
          if (result.recorded && result.audience) {
            this.audienceAttached.emit(result.audience);
          } else {
            // Covers both the no-brief compose and an upstream too old to record one. Either way a
            // real list exists that no send points at, which is the thing the parent warns about --
            // so the absence of `recorded` is reported rather than passed over.
            unattached(result.master);
          }
        },
        error: (httpErr: HttpErrorResponse) => {
          if (run !== this.runGeneration) {
            // A stale partial whose master IS confirmed is still a real list: file its warning.
            const stalePartial = httpErr.status === 502 ? this.asComposePartialBody(httpErr.error) : null;
            if (stalePartial?.master && dispatchProject === this.projectSlug()) {
              this.reportUnattached(stalePartial.master, dispatchBriefId, dispatchProject, dispatchScope);
            }
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
            // The fifth partial shape: both lists exist and only the attach failed. It is the one
            // partial whose master is CONFIRMED, so the parent can offer the same reconcile
            // warning it shows for an unattached compose -- pointing at a list that is real --
            // rather than a generic failure the operator cannot act on.
            if (partial.master) {
              unattached(partial.master);
            }
          } else {
            this.composeError.set(serverAuthoredMessage(httpErr, 'Failed to compose the master list'));
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
   *   - OVER CAP — the server skipped the membership sweep because the sum passed
   *     `AUDIENCE_UNION_EXACT_CAP`, and returns that SUM as the estimate. It is an upper bound on
   *     the union (every contact in two lists is counted twice), so it is shown as `~N`.
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
      // The SUM, not the cap. `OverCapPreviewCount` returns the summed list sizes, so rendering
      // the cap here discarded the number the server actually sent — showing "25,000+" for a
      // 31,500 estimate understates reach by 6,500, the one direction this whole type exists to
      // avoid.
      //
      // "Up to N", not "~N": the sum is strictly an UPPER bound, not an approximation of the
      // truth. Two identical 20,000-contact lists give an estimate of 40,000 and a union of
      // 20,000, so "~40,000" asserts a closeness the number does not have — and "25,000+"
      // asserted the opposite bound entirely.
      return `Up to ${count.estimate.toLocaleString('en-US')}`;
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
    return `Up to ${count.estimate.toLocaleString('en-US')}`;
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
          this.seedSuppression(lists);
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

  /**
   * Pre-ticks every resolved suppression row, once per discovery run.
   *
   * Suppression is mandatory, so the safe default is all of it: the operator unticks a list the
   * send was not written for rather than having to remember to tick each one. A row with no list id
   * cannot be ticked, and a list already included stays included -- ticking it would raise the
   * include/exclude conflict the operator then has to resolve by hand.
   */
  private seedSuppression(lists: readonly AudienceSuppressionList[]): void {
    if (this.suppressionSeeded()) {
      return;
    }
    const next = new Map(this.suppression());
    lists.filter((list) => list.listId !== '' && !this.inclusion().has(list.listId)).forEach((list) => next.set(list.key, list.listId));
    this.suppression.set(next);
    this.suppressionSeeded.set(true);
    this.invalidatePreview();
  }

  /**
   * Records existing lists as this brief's send audience. Nothing is created in HubSpot, so a
   * failure is safe to retry and there is no partial state to reconcile.
   *
   * One list goes up as `masterListId`, several as `includeListIds` -- the send goes to all of them
   * with no master list built. The exclusions are always `extraExclusions` (a past send's own) plus
   * everything ticked or marked Exclude here, so no path can attach without the step-3 suppression.
   */
  private attachExisting(busyId: string, includeIds: readonly string[], extraExclusions: readonly string[], summary: string): void {
    const briefId = this.briefId();
    if (!this.canAttach() || briefId === '' || this.attachInFlight()) {
      return;
    }
    const includes = [...new Set(includeIds)];
    if (includes.length === 0) {
      return;
    }
    const includeSet = new Set(includes);
    const requestedExclusions = [...new Set([...extraExclusions, ...this.excludeIds()])];
    // REFUSED, not filtered: dropping an exclusion that is also being sent to recorded a send that
    // reaches contacts the operator marked for exclusion -- a reused master marked Exclude, or a past
    // send's list now ticked for suppression. The tab's own conflict gate only sees the step-6
    // selection, not the lists an attach brings in, so the overlap is checked here too.
    const conflicting = requestedExclusions.filter((id) => includeSet.has(id));
    if (conflicting.length > 0) {
      this.attachError.set(
        `${conflicting.length === 1 ? 'A list is' : `${conflicting.length} lists are`} both sent to and excluded by this attach. Remove the exclusion or choose different lists.`
      );
      return;
    }
    const sentExclusions = requestedExclusions;
    if (sentExclusions.length > AUDIENCE_ATTACH_MAX_LIST_IDS) {
      this.attachError.set(`At most ${AUDIENCE_ATTACH_MAX_LIST_IDS} lists can be excluded from one send.`);
      return;
    }
    if (sentExclusions.length === 0) {
      this.attachError.set('Select at least one suppression list in step 3 first.');
      return;
    }
    const run = this.runGeneration;
    const dispatchProject = this.projectSlug();
    const base = { briefId, suppressionListIds: sentExclusions, ...(summary ? { inclusionSummary: summary } : {}) };
    const request: AudienceAttachExistingRequest = includes.length === 1 ? { ...base, masterListId: includes[0] } : { ...base, includeListIds: includes };
    this.attachInFlight.set(true);
    this.attachingId.set(busyId);
    this.attachError.set(null);
    this.campaignService
      .attachExistingAudience(this.projectSlug(), request)
      // Released when the REQUEST settles -- see `attachInFlight`. The generation guards below
      // still decide whether its result is shown.
      .pipe(
        finalize(() => this.attachInFlight.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          // Reported past the generation guard when the PROJECT is unchanged. The attach is recorded
          // upstream whatever the panel did meanwhile, and the parent accepts the row only for the
          // brief it is addressing now -- so after an event round trip A -> B -> A the row lands on
          // A, where otherwise the lock released at `finalize` while the parent still showed the old
          // audience upstream no longer resolves. It is withheld while ANOTHER project is on screen;
          // after a round trip back, the parent's brief-id check is what keeps it to its own brief.
          if (run === this.runGeneration || dispatchProject === this.projectSlug()) {
            this.audienceAttached.emit(result.audience);
          }
          if (run !== this.runGeneration) {
            return;
          }
          // Settled, so the next write may start -- released here rather than on a brief switch.
          this.attachInFlight.set(false);
          // The local banner IS guarded: it would describe the previous brief.
          if (briefId !== this.briefId()) {
            return;
          }
          this.attachingId.set(null);
          this.attachResult.set(result);
          this.lastWriteWasAttach.set(true);
        },
        error: (httpErr: HttpErrorResponse) => {
          if (run !== this.runGeneration) {
            return;
          }
          this.attachInFlight.set(false);
          if (briefId !== this.briefId()) {
            return;
          }
          this.attachingId.set(null);
          this.attachError.set(serverAuthoredMessage(httpErr, 'Failed to attach the lists to this email'));
        },
      });
  }

  /**
   * Records a confirmed master this panel just created, so the reuse grid can offer it.
   *
   * The recovery for an unattached compose is "Use for this email" on that master, but the grid is
   * loaded once at discovery and discovery of the same URL is blocked after a compose -- so the new
   * list never appeared there. Held APART from the fetched lists rather than written into them: the
   * masters fetch can land after the compose and `set` its own answer, which wiped a row inserted
   * into the same signal. `reuseMasterLists` is the union.
   */
  private rememberComposedMaster(master: AudienceComposedList): void {
    if (this.composedMasterLists().some((list) => list.listId === master.listId)) {
      return;
    }
    const row: AudienceMasterListBrief = { listId: master.listId, name: master.name, hubspotUrl: master.hubspotUrl, size: master.size };
    this.composedMasterLists.update((lists) => [row, ...lists]);
  }

  private add(listId: string, name: string): void {
    if (this.inclusion().has(listId)) {
      return;
    }
    // Including a list un-marks it as an exclusion: a list cannot be both.
    this.dropExclusion(listId);
    const next = new Map(this.inclusion());
    next.set(listId, name);
    this.inclusion.set(next);
    this.invalidatePreview();
  }

  /**
   * `key` is the map's identity and `value` what it carries: list id -> name for inclusion, row
   * key -> list id for suppression. The two maps deliberately do not share a key space.
   */
  private toggle(target: typeof this.inclusion, key: string, value: string): void {
    const next = new Map(target());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    target.set(next);
    this.invalidatePreview();
  }

  private dropExclusion(listId: string): void {
    if (!this.exclusion().has(listId)) {
      return;
    }
    const next = new Map(this.exclusion());
    next.delete(listId);
    this.exclusion.set(next);
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
   * Narrows an error body to a compose-partial when it carries ANY of the four states that make
   * one actionable: a confirmed suppression list, a confirmed master list whose attach failed, or
   * the deterministic name of a suppression or master list whose create could not be confirmed.
   *
   * Keying on `suppression.listId` alone was wrong — five shapes are reachable and only two
   * carry a confirmed list (`docs/api-catalog.md` in campaign-service). The others were rendered
   * as ordinary failures, losing the names the operator needs to find lists that may exist. That is
   * the worst possible loss on this path: compose is not idempotent, so composing again after an
   * unconfirmed create either collides on a duplicate name or leaves a second list behind.
   *
   * A body with none of the four is an ordinary failure, however it was framed.
   */
  private asComposePartialBody(body: unknown): AudienceComposeMasterPartial | null {
    if (body === null || typeof body !== 'object') {
      return null;
    }
    const candidate = body as { suppression?: { listId?: unknown }; suppressionName?: unknown; masterName?: unknown; master?: { listId?: unknown } };
    const confirmedList = (list: { listId?: unknown } | undefined): boolean =>
      list !== undefined && list !== null && typeof list === 'object' && typeof list.listId === 'string' && list.listId.length > 0;
    const hasSuppression = confirmedList(candidate.suppression);
    // The FIFTH shape, added with the recording compose: both lists confirmed, the attach failed.
    // Without it that body fell through to `composeError` and the operator lost the link to a
    // master list that genuinely exists -- on the one partial where the list is usable as it
    // stands.
    const hasMaster = confirmedList(candidate.master);
    const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

    return hasSuppression || hasMaster || nonEmpty(candidate.suppressionName) || nonEmpty(candidate.masterName) ? (body as AudienceComposeMasterPartial) : null;
  }

  /** Tells the parent about a master that exists but was not recorded, scoped by its dispatch. */
  private reportUnattached(master: AudienceComposedList, briefId: string, projectSlug: string, scope: number): void {
    this.audienceComposeUnattached.emit({ master, briefId, projectSlug, scope });
  }

  /** Whether a brief arriving now is for a different event than the panel's work. See the reset. */
  private isDifferentEvent(previousKey: string, nextKey: string, previousUrl: string, advertised: string): boolean {
    const edited = this.eventUrlControl.dirty;
    // The work's URL: what was discovered, or -- before any discovery -- what the operator typed.
    const workUrl = this.discoveredEventUrl() || this.eventUrlControl.value.trim();
    // An EMPTY advertised URL is a mismatch too, unless the work has no URL either: a brief with no
    // URL is no evidence the work was for its event.
    const discoveredElsewhere = workUrl !== advertised;
    if (previousKey === '') {
      // First brief after exploratory work: kept only if it was discovered for this brief's URL.
      return edited && discoveredElsewhere;
    }
    if (previousKey !== nextKey) {
      return true;
    }
    if (edited) {
      return discoveredElsewhere;
    }
    // Same event, untouched field: a CORRECTED or REMOVED advertised URL means the lists came from
    // the old one.
    return previousUrl !== '' && previousUrl !== advertised;
  }

  /**
   * Starts the panel over for a new project or event, keeping the one fact the reset must not lose.
   *
   * A compose in flight is not cancelled by the reset -- the HubSpot lists are already being
   * created -- and its reply is about to be discarded by the run-generation guard. The reset itself
   * is still correct: showing the previous context's discovery is its own defect. So reset, and
   * record the create as unconfirmed in the context it was made in, because losing that silently
   * is how a duplicate gets composed later.
   */
  private resetForNewContext(strandedIn: string): void {
    const wasComposing = this.composing();
    this.resetRunState();
    if (wasComposing) {
      this.composeStranded.set(true);
      this.strandedProject.set(strandedIn);
    }
  }

  /**
   * Compose is NOT idempotent and a reset does not cancel it — the HubSpot lists are already
   * being created by the time a reply lands. Discarding a stale reply is right for every other
   * request here, but for compose it would leave real lists with no confirmation and no orphan
   * link, and a retry would duplicate them.
   *
   * So Discover is disabled while `composing`, and the two resets that CAN arrive during a compose
   * -- a project switch and a different event's brief -- go through `resetForNewContext`, which
   * records the create as stranded instead of losing it.
   */
  private resetRunState(): void {
    // Invalidate every in-flight reply from the previous run BEFORE clearing the state they
    // would otherwise repopulate.
    this.runGeneration += 1;
    this.composing.set(false);
    this.previewing.set(false);
    // `searching` belongs here with its siblings. Guarding onSearch's ERROR handler on the run
    // generation means a search still in flight when the run resets can no longer clear this
    // flag itself — its late reply is discarded by design. Without the reset the typeahead
    // spinner never stops. The guard and this line are one fix, not two.
    this.searching.set(false);
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
    this.discoveredEventUrl.set('');
    this.identity.set(null);
    this.discoveredLists.set([]);
    this.missingSignals.set([]);
    this.lastSentEmails.set([]);
    this.existingMasterLists.set([]);
    this.composedMasterLists.set([]);
    this.looseComposedMaster.set(null);
    this.suppressionLists.set([]);
    this.suppressionFailed.set(false);
    this.mastersFailed.set(false);
    this.emailsFailed.set(false);
    this.searchResults.set([]);
    this.inclusion.set(new Map());
    this.suppression.set(new Map());
    this.exclusion.set(new Map());
    // The next run's suppression rows are pre-ticked afresh.
    this.suppressionSeeded.set(false);
    this.composeResult.set(null);
    this.composePartial.set(null);
    this.composeError.set(null);
    // A failed discover belongs to the run that failed. Without this, foundation A's error stays
    // on screen after a project switch and reads as foundation B's.
    this.discoveryError.set(null);
    this.composeAttempted.set(false);
    this.replaceRequestedFor.set(null);
    // `attachInFlight` and `composeOnWire` are deliberately NOT released here: the requests are
    // still running, and their own `finalize` releases them when they settle.
    this.attachingId.set(null);
    this.attachResult.set(null);
    this.attachError.set(null);
    this.copiedSuppressionNames.set(new Map());
    this.invalidatePreview();
  }

  /**
   * Called on every selection edit. Bumping the sequence is the half that matters: clearing the
   * displayed count does nothing about a request already in flight, whose reply would otherwise
   * land and be read as the count for the NEW selection. Discarding that reply means it can no
   * longer clear `previewing` itself, so this resets the spinner too — the bump and the reset are
   * one fix, the same way the run-generation guard and `resetRunState` were.
   */
  private invalidatePreview(): void {
    this.previewSeq += 1;
    this.previewCount.set(null);
    this.previewError.set(null);
    this.previewing.set(false);
  }
}
