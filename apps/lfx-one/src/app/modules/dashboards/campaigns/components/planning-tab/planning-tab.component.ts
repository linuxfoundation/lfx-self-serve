// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CAMPAIGN_GOALS, CAMPAIGN_PLATFORMS } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, Subject, Subscription, switchMap } from 'rxjs';

import type {
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefRefineRequest,
  CampaignEventDetails,
  CampaignDeliveryType,
  CampaignGoal,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformOption,
  CampaignProgramTypeOption,
  CampaignSSEEventType,
  HubSpotUtmLookupResult,
  LinkedInBriefCopy,
  LinkedInCreativeVariant,
  LinkedInGeoTarget,
  LinkedInTargetingProfile,
  LinkedInTargetingStrategy,
  SSEEvent,
} from '@lfx-one/shared/interfaces';

type PlanningStep = 'input' | 'generating' | 'review';

@Component({
  selector: 'lfx-planning-tab',
  imports: [ReactiveFormsModule, ButtonComponent, NgClass],
  templateUrl: './planning-tab.component.html',
  styleUrl: './planning-tab.component.scss',
})
export class PlanningTabComponent implements OnInit {
  // === Services ===
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly fb = inject(FormBuilder);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs ===
  public readonly programTypeConfig = input.required<CampaignProgramTypeOption>();

  /**
   * Which delivery channel this planner is planning for (LFXV2-3201).
   *
   * One component rather than two, because the halves the two types genuinely share are the
   * expensive ones: the event URL, the scrape, the goal/audience/value-prop inputs, the SSE
   * generation stream, and the brief save/restore round trip. What differs is a single card and
   * one validity rule, which is a poor reason to fork ~800 lines and then maintain the shared
   * parts twice.
   *
   * Defaults to `paid-marketing` so the paid container's binding is unchanged and this input is
   * additive — an omitted binding keeps exactly today's behaviour.
   */
  public readonly deliveryType = input<CampaignDeliveryType>('paid-marketing');

  /** Whether this planner is planning an email rather than paid ads. */
  protected readonly isEmail = computed(() => this.deliveryType() === 'email');

  // === Outputs ===
  public readonly proceedToImplementation = output<CampaignBriefOutput>();

  /**
   * A brief RESTORED from campaign-service, as opposed to one just generated.
   *
   * A separate output rather than a flag on the one above, because the difference is not a
   * detail of the payload: a generated brief has never been stored and must be, while a
   * restored one came out of storage and must NOT be written back. Emitting both through one
   * channel would leave the parent guessing which it received.
   */
  public readonly restoreSavedBriefRequested = output<{ brief: CampaignBriefOutput; briefId: string }>();

  // === Constants ===
  protected readonly platforms: CampaignPlatformOption[] = [...CAMPAIGN_PLATFORMS];
  protected readonly goals = computed(() => {
    const goalLabel = this.programTypeConfig().goalLabel;
    return CAMPAIGN_GOALS.map((g) => (g.id === 'conversions' ? { ...g, label: goalLabel } : g));
  });

  // === Forms ===
  protected readonly briefForm = this.fb.nonNullable.group({
    url: ['', [Validators.required]],
    campaignGoal: ['conversions'],
    targetAudience: [''],
    valueProp: [''],
    totalBudget: [''],
    driveFolderUrl: [''],
  });

  // === WritableSignals ===
  protected readonly step = signal<PlanningStep>('input');
  protected readonly selectedPlatforms = signal<Set<CampaignPlatform>>(new Set(['google-ads']));
  protected readonly statusMessages = signal<string[]>([]);
  protected readonly eventDetails = signal<CampaignEventDetails | null>(null);
  protected readonly copyBuffer = signal('');
  protected readonly structuredCopy = signal<Record<string, unknown> | null>(null);
  protected readonly hsUtm = signal<string | null>(null);
  protected readonly hsSearching = signal(false);
  protected readonly hsCreating = signal(false);
  protected readonly hsStatus = signal<string | null>(null);
  protected readonly hsNotFound = signal(false);
  protected readonly hsMatches = signal<{ name: string; hs_utm: string }[]>([]);
  protected readonly keywords = signal<CampaignKeyword[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly linkedInStrategy = signal<LinkedInTargetingStrategy | null>(null);
  protected lastLookedUpEvent = '';
  private readonly urlInput$ = new Subject<string>();

  /**
   * A brief already saved for the event in the URL field, offered rather than applied.
   *
   * Never restored automatically. The user typed a URL to start a campaign; silently replacing
   * the empty form with someone's earlier work — possibly their own from a month ago — takes a
   * decision away from them and hides the fact that a stored brief exists at all. The banner
   * says what was found and leaves the choice.
   */
  protected readonly savedBrief = signal<CampaignBriefOutput | null>(null);

  /**
   * Why no brief is on offer, when that is worth saying.
   *
   * Two cases: `unreadable` means a brief EXISTS for this event and this build cannot open it,
   * and a failed lookup means we do not know. Both are worth saying BEFORE the user spends an
   * afternoon regenerating — but the reason changed with LFXV2-3200 and the copy changed with
   * it. The next save is no longer a find-then-UPDATE that quietly replaces whatever is there;
   * it is refused as unowned, because a brief that cannot be opened cannot be restored and so
   * the page can never hold its id. The warning now says the save will be REFUSED rather than
   * that it will replace. `none` sets this to null — there is nothing to warn about.
   */
  protected readonly savedBriefWarning = signal<string | null>(null);

  /**
   * Text for the always-present live region in the template.
   *
   * Both branches it covers appear ASYNCHRONOUSLY — a lookup answers some time after the user
   * stopped typing — so without this a screen-reader user is never told that a Restore action
   * became available, or that generating will now replace something. The offer wins when both
   * are set: it is the one that carries an action.
   */
  protected readonly savedBriefAnnouncement = computed(() => {
    const saved = this.savedBrief();
    const warning = this.savedBriefWarning();
    if (saved !== null) {
      const name = saved.eventDetails.name || saved.eventDetails.slug;
      const offer = `A saved brief was found for ${name}. A restore action is available.`;
      // Both, when both are set. The offer used to win outright, which was right while a warning
      // meant there was nothing to restore. It is not any more: a loaded-but-unapproved brief now
      // sets BOTH, and announcing only the offer drops the half that says the brief cannot be
      // used downstream — the visible banner says it, so a screen reader must too.
      return warning === null ? offer : `${offer} ${warning}`;
    }
    return warning ?? '';
  });

  /** The id of the brief `savedBrief` holds. Kept in step with it; see `applySavedBrief`. */
  private savedBriefId: string | null = null;

  private readonly slugInput$ = new Subject<string>();

  /**
   * The slug the page is currently showing, as opposed to the one a given lookup was issued for.
   *
   * Read by the lookup subscription to drop a response whose key is no longer current. Kept as a
   * plain field rather than a signal because nothing renders it — it exists only to answer "is
   * this answer still about the thing on screen?" at the moment a response arrives.
   */
  private currentSlug = '';

  // === Editable Review Signals ===
  protected readonly editSearchHeadlines = signal<string[]>([]);
  protected readonly editSearchDescriptions = signal<string[]>([]);
  protected readonly editDisplayHeadlines = signal<string[]>([]);
  protected readonly editDisplayDescriptions = signal<string[]>([]);
  protected readonly editDisplayBusinessName = signal('');
  protected readonly editDisplayCta = signal('');
  protected readonly editKeywords = signal<CampaignKeyword[]>([]);
  protected readonly isEditing = signal(false);

  // === Refine Mode Signals ===
  protected readonly isRefining = signal(false);
  protected readonly refineFeedback = signal('');
  protected readonly refineStatusMessages = signal<string[]>([]);
  protected readonly isRefineStreaming = signal(false);
  protected readonly lastAppliedFeedback = signal<string | null>(null);
  protected readonly refineCount = signal(0);

  // === Computed Signals ===
  private readonly formValid = toSignal(this.briefForm.statusChanges, { initialValue: this.briefForm.status });
  /**
   * Email has no ad-channel requirement, and that asymmetry is the point of LFXV2-3201.
   *
   * The paid rule stands: a brief with no platform selected produces copy for nothing, so the
   * gate is real there. For email the same rule was a dead end — the user was shown "Ad Channels"
   * under a tab labelled Email and had to pick Google Ads before the channel would let them
   * proceed, which is not a requirement so much as a bug wearing one's clothes.
   */
  protected readonly canGenerate = computed(() => this.formValid() === 'VALID' && (this.isEmail() || this.selectedPlatforms().size > 0));
  protected readonly isGenerating = computed(() => this.step() === 'generating');
  protected readonly hasResults = computed(() => this.step() === 'review');
  protected readonly linkedInSponsoredCopy = computed<Record<string, unknown> | null>(() => {
    const copy = this.structuredCopy();
    if (!copy) return null;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    return (copy['linkedin_sponsored'] as Record<string, unknown>) ?? (nested?.['linkedin_sponsored'] as Record<string, unknown>) ?? null;
  });

  // === Private State ===
  private briefSubscription: Subscription | null = null;

  /**
   * The foundation whose brief table the read-back should look in.
   *
   * A foundation switch does NOT re-create this component: `/foundation/campaigns` is a
   * two-segment route in the foundation lens, and `sidebar.component.ts`
   * `redirectOnContextSwitch` navigates only on a lens change or off an entity page, so a
   * same-lens pick just moves `?project=` with `Location.replaceState`. The page stays mounted
   * and `activeContext()` changes underneath it — which makes the foundation part of the lookup
   * key, not a value that can be read once.
   *
   * Built as an observable field rather than inside `ngOnInit` because `toObservable` needs an
   * injection context, and field initialisers have one.
   */
  /**
   * The active foundation slug, coalesced to `''` when there is no context.
   *
   * Shared by the lookup pipeline and the stale-response guard rather than each reading
   * `activeContext()?.slug` for itself: the guard compares the value a response was REQUESTED
   * with against the value now current, and the pipeline's `?? ''` means an absent context
   * reaches it as `''`. A guard re-deriving the raw `undefined` would compare `'' !== undefined`
   * and discard every legitimate response while no foundation is selected.
   */
  private readonly activeFoundationSlug = computed(() => this.projectContextService.activeContext()?.slug ?? '');

  private readonly activeFoundationSlug$ = toObservable(this.activeFoundationSlug);

  // === Lifecycle ===
  public ngOnInit(): void {
    this.urlInput$.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe((eventName) => this.lookupHubSpot(eventName));

    // `switchMap`, so an edited URL cancels the lookup for the previous one. The persist path
    // needed a generation counter for the same hazard because its request must outlive the
    // component; this one must not, and a subscription that drops the stale response is the
    // simpler answer. `catchError` is INSIDE the switchMap so one failed lookup does not
    // terminate the stream and leave every later URL unchecked.
    //
    // Keyed on the foundation as well as the slug — see `activeFoundationSlug$`. A brief belongs
    // to one foundation's table, so the same event slug is a different lookup under a different
    // foundation, and `combineLatest` re-runs it when either half moves. `distinctUntilChanged`
    // compares the PAIR, so a re-emission that changes neither is still dropped.
    // The response carries the key it was REQUESTED for, and `applySavedBrief` drops it when
    // that key is no longer current. Reordering these operators cannot fix THAT on its own:
    // `switchMap` can only unsubscribe once a value reaches it, and the debounce necessarily
    // withholds that value for 500ms, so an in-flight lookup always survives a key change made
    // inside the window — which is why the response is keyed rather than relying on cancellation.
    //
    // The ORDER still matters, for a different failure, and an earlier revision had it backwards
    // because this paragraph reads as a general argument against reordering. `distinctUntilChanged`
    // sits FIRST so that every intermediate key reaches the comparer. With the debounce first, a
    // key that changes and reverts inside the window never arrives as an intermediate value: the
    // eager clear in `onUrlInput` has already wiped the offer, the comparer then drops the
    // reverted pair as unchanged, and no lookup runs — the offer stranded for a brief that
    // exists. `onUrlInput` and the foundation subscription below both clear the offer
    // eagerly; without this guard the late response simply sets it again, for an event or a
    // foundation the user has already left.
    combineLatest([this.slugInput$, this.activeFoundationSlug$])
      .pipe(
        distinctUntilChanged(([slug, project], [nextSlug, nextProject]) => slug === nextSlug && project === nextProject),
        debounceTime(500),
        switchMap(([slug, project]) =>
          this.campaignService.loadBrief(slug, project).pipe(
            map((result) => ({ slug, project, result })),
            catchError(() => of({ slug, project, result: null }))
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ slug, project, result }) => {
        if (slug !== this.currentSlug || project !== this.activeFoundationSlug()) {
          return;
        }
        this.applySavedBrief(result);
      });

    // Clear the offer the MOMENT the foundation changes, not when the re-lookup answers. Between
    // those two points the brief on screen is one that was found in the previous foundation's
    // table, and the restore button would hand it to the Implementation tab under the new one.
    // The same eager-clear reasoning as `onUrlInput`, for the other half of the key.
    //
    // `skip(1)` because `toObservable` replays the current foundation on subscribe, and the one
    // the page opened with is not a change.
    this.activeFoundationSlug$.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.savedBrief.set(null);
      this.savedBriefId = null;
      this.savedBriefWarning.set(null);
    });
  }

  // === Public Methods ===
  public reset(): void {
    this.briefSubscription?.unsubscribe();
    this.briefSubscription = null;
    this.step.set('input');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.copyBuffer.set('');
    this.structuredCopy.set(null);
    this.hsUtm.set(null);
    this.keywords.set([]);
    this.linkedInStrategy.set(null);
    this.errorMessage.set(null);
    // The restore offer is deliberately NOT cleared here, unlike everything above it.
    //
    // Cancel and New Brief discard the GENERATED brief. They say nothing about the STORED one,
    // which is still there and still the user's, and the offer is how they reach it without
    // regenerating. The offer's validity depends on `(slug, foundation)` alone — reset changes
    // neither — so what was true before it is still true after.
    //
    // Clearing it stranded the offer permanently rather than merely hiding it. `onUrlInput`
    // issues a lookup only when the slug CHANGES (`currentSlug` records what was last looked up),
    // and reset leaves the url field untouched, so retyping the same url is correctly a no-op and
    // no keystroke could bring the offer back. Re-pushing the slug does not work either: the
    // pipeline's `distinctUntilChanged` drops the unchanged `(slug, project)` pair, which is the
    // same trap the comment in `onUrlInput` already warns about. The next Proceed then created a
    // second row and hit the unowned-brief conflict.
    //
    // `savedBriefId` is left in step with `savedBrief` by saying nothing about either — the pair
    // is only ever written together, which is what `restoreSavedBrief`'s both-or-neither guard
    // depends on.
    this.isEditing.set(false);
    this.isRefining.set(false);
    this.isRefineStreaming.set(false);
    this.refineFeedback.set('');
    this.refineStatusMessages.set([]);
    this.lastAppliedFeedback.set(null);
    this.refineCount.set(0);
  }

  // === Protected Methods ===
  protected togglePlatform(platformId: CampaignPlatform): void {
    const current = new Set(this.selectedPlatforms());
    if (current.has(platformId)) {
      current.delete(platformId);
    } else {
      current.add(platformId);
    }
    this.selectedPlatforms.set(current);
  }

  protected isPlatformSelected(platformId: CampaignPlatform): boolean {
    return this.selectedPlatforms().has(platformId);
  }

  protected asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value.filter((v) => v != null) : null;
  }

  protected onUrlInput(): void {
    const url = this.briefForm.controls.url.value.trim();
    const eventName = this.extractEventName(url);
    if (eventName.length > 3) {
      this.urlInput$.next(eventName);
    }

    // Keyed on the slug, not the event name: the slug is what the brief was filed under.
    //
    // This derivation is NOT identical to the write path's. `deriveEventSlug` reads
    // `brief.eventDetails.slug`, which the generator produced from the scraped event page,
    // while this reads the pasted URL's last path segment. They agree whenever the scraper
    // echoes the segment, which is the ordinary case — but a normalized slug (different case,
    // stripped punctuation, a redirect to a canonical path) makes the lookup MISS a brief that
    // exists, and the user is offered nothing rather than a restore.
    //
    // A miss is NOT merely a wasted regeneration, and an earlier version of this comment was
    // wrong to say so. `saveBrief` runs its own `findBrief` keyed on the GENERATED slug, so
    // after the user regenerates, the save finds the row this lookup missed and PUTs over it —
    // the saved edits are gone and Restore was never offered. The two paths agreeing matters
    // for durability, not just for convenience.
    //
    // Not closed here because the fix is not local: the read would have to key off the
    // generated brief, which does not exist until after generation and so cannot serve the
    // pre-generation offer this feature is for. Tracked as LFXV2-3200.
    //
    // Cleared only when the slug changes AND a lookup will follow to replace what was cleared.
    //
    // Two ways to get this wrong, and the naive version hits both. Clearing on every keystroke
    // wipes the offer while `distinctUntilChanged` drops the unchanged pair, so nothing re-fetches
    // it. Clearing whenever the slug differs has the same end: emptying the field sets
    // `currentSlug` to '' with no lookup issued, and retyping the SAME url then clears again and
    // pushes a slug the pipeline may drop as unchanged — the offer gone for a brief that exists.
    //
    // Advancing `currentSlug` only on the branch that also emits keeps the two in step: the field
    // records what was last LOOKED UP, not what was last typed, so an empty field leaves both the
    // offer and the key alone and retyping the same url is correctly a no-op with the offer still
    // on screen.
    const slug = this.extractSlug(url);
    if (slug.length > 0) {
      if (slug !== this.currentSlug) {
        this.currentSlug = slug;
        this.savedBrief.set(null);
        this.savedBriefId = null;
        this.savedBriefWarning.set(null);
      }
      this.slugInput$.next(slug);
    }
  }

  /** Hand the saved brief straight to the Implementation tab, skipping generation. */
  protected restoreSavedBrief(): void {
    // Refuse when the field no longer names the event this offer was fetched for. The offer is
    // deliberately KEPT while the url is empty or half-typed — clearing it there strands it, since
    // `onUrlInput` only issues a lookup when the slug CHANGES and retyping the same url is a
    // no-op — but keeping it visible must not mean acting on it. Mid-edit toward event B, the
    // panel still reads "A brief was already saved for <A>", and restoring then hands the
    // Implementation tab a brief for an event the user is in the middle of leaving.
    //
    // Guarding the ACTION rather than the offer keeps both properties: the offer survives an
    // emptied field and comes back when the url is retyped, and it can only ever be applied while
    // the field still names its own event.
    if (this.extractSlug(this.briefForm.controls.url.value) !== this.currentSlug) {
      return;
    }
    const brief = this.savedBrief();
    // Both, or neither. A restore without its id would reach the parent as an unowned save and
    // be refused — a worse outcome than not offering the button, so the guard covers the pair.
    if (brief !== null && this.savedBriefId !== null) {
      this.restoreSavedBriefRequested.emit({ brief, briefId: this.savedBriefId });
    }
  }

  protected selectHsMatch(hsUtm: string, name: string): void {
    this.hsUtm.set(hsUtm);
    this.hsStatus.set(`Selected: ${name}`);
  }

  protected createInHubSpot(): void {
    if (!this.lastLookedUpEvent) return;
    this.hsCreating.set(true);
    this.hsStatus.set(null);
    this.campaignService
      .createHubSpotUtm(this.lastLookedUpEvent)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (result?.created && result.hs_utm) {
            this.hsUtm.set(result.hs_utm);
            this.hsNotFound.set(false);
            this.hsStatus.set(`Created: ${result.campaign_name}`);
          } else {
            this.hsStatus.set('Failed to create campaign');
          }
          this.hsCreating.set(false);
        },
        error: () => {
          this.hsStatus.set('Create failed');
          this.hsCreating.set(false);
        },
      });
  }

  protected generate(): void {
    if (!this.canGenerate()) return;

    this.step.set('generating');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.copyBuffer.set('');
    this.structuredCopy.set(null);
    this.keywords.set([]);
    this.linkedInStrategy.set(null);
    this.errorMessage.set(null);

    const budgetRaw = this.briefForm.controls.totalBudget.value;
    const budgetStr = typeof budgetRaw === 'string' ? budgetRaw.trim() : String(budgetRaw ?? '');
    const request = {
      url: this.briefForm.controls.url.value.trim(),
      // Sent explicitly. Omitting `platforms` is NOT enough on its own to mean "no ad channels":
      // the generator reads an absent list as the paid DEFAULT (`['google-ads']`), so absence
      // already means "use the default" for every paid caller and cannot also mean email. This
      // field is what makes the server skip ad-copy and keyword generation entirely.
      deliveryType: this.deliveryType(),
      // Still omitted for email — `[]` would claim the user deselected every channel rather than
      // that ad channels do not apply here. With `deliveryType` above, the server no longer has
      // to infer anything from its absence.
      ...(this.isEmail() ? {} : { platforms: [...this.selectedPlatforms()] as CampaignPlatform[] }),
      campaignGoal: (this.briefForm.controls.campaignGoal.value || undefined) as CampaignGoal | undefined,
      targetAudience: this.briefForm.controls.targetAudience.value.trim() || undefined,
      valueProp: this.briefForm.controls.valueProp.value.trim() || undefined,
      // Belt and braces with hiding the Budget card: the control still EXISTS in email mode, and
      // a value could reach it without the card being visible — a restored paid brief repopulates
      // the form. The server appends "Total Campaign Budget: $N" to the copy prompt, so a stray
      // value would put a paid-ad number into an email brief rather than merely go unread.
      totalBudget: !this.isEmail() && budgetStr && Number.isFinite(Number(budgetStr)) ? Number(budgetStr) : undefined,
      programType: this.programTypeConfig().id,
    };

    this.briefSubscription = this.campaignService
      .generateBrief(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: SSEEvent<CampaignSSEEventType>) => this.handleSSEEvent(event),
        error: () => {
          this.errorMessage.set('Connection lost. Please try again.');
          this.step.set('input');
        },
        complete: () => {
          if (this.step() === 'generating') {
            this.step.set('review');
          }
        },
      });
  }

  protected onProceedToImplementation(): void {
    if (this.isEditing()) {
      this.saveEdits();
    }
    const url = this.briefForm.controls.url.value.trim();
    const fallbackName = this.extractEventName(url);
    const fallbackSlug = this.extractSlug(url);
    const details: CampaignEventDetails = this.eventDetails() ?? {
      name: fallbackName,
      dates: '',
      city: '',
      countryCode: 'US',
      audience: '',
      themes: [],
      registrationUrl: url,
      speakers: [],
      slug: fallbackSlug,
      formatNotes: '',
    };
    const budgetRaw2 = this.briefForm.controls.totalBudget.value;
    const budgetStr = typeof budgetRaw2 === 'string' ? budgetRaw2.trim() : String(budgetRaw2 ?? '');
    this.proceedToImplementation.emit({
      eventDetails: details,
      structuredCopy: this.structuredCopy(),
      keywords: this.keywords(),
      hsUtm: this.hsUtm(),
      totalBudget: budgetStr && Number.isFinite(Number(budgetStr)) ? Number(budgetStr) : null,
      driveFolderUrl: this.briefForm.controls.driveFolderUrl.value.trim(),
      campaignGoal: (this.briefForm.controls.campaignGoal.value as CampaignGoal) || null,
      selectedPlatforms: [...this.selectedPlatforms()],
      linkedInCopy: this.getLinkedInCopy(),
      programType: this.programTypeConfig().id,
    });
  }

  protected copyToClipboard(): void {
    if (isPlatformBrowser(this.platformId) && navigator.clipboard) {
      navigator.clipboard.writeText(this.copyBuffer()).catch(() => {
        /* clipboard access denied — fail gracefully */
      });
    }
  }

  protected getSearchCopy(): Record<string, unknown> | null {
    const copy = this.structuredCopy();
    if (!copy) return null;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    return (copy['google_search'] as Record<string, unknown>) ?? (nested?.['google_search'] as Record<string, unknown>) ?? null;
  }

  protected getDisplayCopy(): Record<string, unknown> | null {
    const copy = this.structuredCopy();
    if (!copy) return null;
    const nested = copy['platforms'] as Record<string, unknown> | undefined;
    return (
      (copy['google_display'] as Record<string, unknown>) ??
      (copy['demand_gen'] as Record<string, unknown>) ??
      (nested?.['google_display'] as Record<string, unknown>) ??
      (nested?.['demand_gen'] as Record<string, unknown>) ??
      null
    );
  }

  protected asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
  }

  protected intentClass(level: string): string {
    switch (level) {
      case 'High':
        return 'bg-green-100 text-green-700';
      case 'Medium':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  protected enterEditMode(): void {
    const search = this.getSearchCopy();
    const display = this.getDisplayCopy();
    this.editSearchHeadlines.set([...this.asStringArray(search?.['headlines'])]);
    this.editSearchDescriptions.set([...this.asStringArray(search?.['descriptions'])]);
    this.editDisplayHeadlines.set([...this.asStringArray(display?.['headlines'])]);
    this.editDisplayDescriptions.set([...this.asStringArray(display?.['descriptions'])]);
    this.editDisplayBusinessName.set((display?.['business_name'] as string) ?? '');
    this.editDisplayCta.set((display?.['call_to_action'] as string) ?? '');
    this.editKeywords.set(this.keywords().map((kw) => ({ ...kw })));
    this.isEditing.set(true);
  }

  protected saveEdits(): void {
    const copy = { ...(this.structuredCopy() ?? {}) };
    const search = { ...((this.getSearchCopy() as Record<string, unknown>) ?? {}) };
    const display = { ...((this.getDisplayCopy() as Record<string, unknown>) ?? {}) };

    search['headlines'] = this.editSearchHeadlines();
    search['descriptions'] = this.editSearchDescriptions();
    display['headlines'] = this.editDisplayHeadlines();
    display['descriptions'] = this.editDisplayDescriptions();
    display['business_name'] = this.editDisplayBusinessName();
    display['call_to_action'] = this.editDisplayCta();

    copy['google_search'] = search;
    const displayKey = copy['demand_gen'] ? 'demand_gen' : 'google_display';
    copy[displayKey] = display;

    this.structuredCopy.set(copy);
    this.keywords.set(this.editKeywords());
    this.isEditing.set(false);
  }

  protected cancelEdit(): void {
    this.isEditing.set(false);
  }

  protected updateEditItem(arr: string[], index: number, value: string): string[] {
    const updated = [...arr];
    updated[index] = value;
    return updated;
  }

  protected addEditItem(sig: typeof this.editSearchHeadlines): void {
    sig.update((items) => [...items, '']);
  }

  protected removeEditItem(sig: typeof this.editSearchHeadlines, index: number): void {
    sig.update((items) => items.filter((_, i) => i !== index));
  }

  protected updateKeywordField(index: number, field: keyof CampaignKeyword, value: string): void {
    this.editKeywords.update((kws) => {
      const updated = kws.map((kw) => ({ ...kw }));
      (updated[index] as Record<string, string>)[field] = value;
      return updated;
    });
  }

  protected addKeyword(): void {
    this.editKeywords.update((kws) => [...kws, { term: '', matchType: 'Broad', intentLevel: 'Medium', notes: '' }]);
  }

  protected removeKeyword(index: number): void {
    this.editKeywords.update((kws) => kws.filter((_, i) => i !== index));
  }

  protected enterRefineMode(): void {
    this.isRefining.set(true);
    this.refineFeedback.set('');
    this.refineStatusMessages.set([]);
  }

  protected cancelRefine(): void {
    this.isRefining.set(false);
    this.refineFeedback.set('');
    this.refineStatusMessages.set([]);
  }

  protected submitRefine(): void {
    const feedback = this.refineFeedback().trim();
    if (!feedback) return;

    const currentCopy = this.structuredCopy();
    if (!currentCopy) return;

    this.isRefineStreaming.set(true);
    this.refineStatusMessages.set([]);
    this.copyBuffer.set('');

    const capturedFeedback = feedback;

    const request: CampaignBriefRefineRequest = {
      currentCopy,
      currentKeywords: this.keywords(),
      feedback: capturedFeedback,
      eventDetails: this.eventDetails(),
      // Same pair as the generate request: the delivery type is the signal the server acts on,
      // and `platforms` is omitted rather than emptied. The server refuses an email refine
      // outright — there is no email copy to refine until the `email-copy` endpoint lands
      // (LFXV2-3198) — so this carries the type to get that refusal rather than a broken call.
      deliveryType: this.deliveryType(),
      ...(this.isEmail() ? {} : { platforms: [...this.selectedPlatforms()] }),
      programType: this.programTypeConfig().id,
    };

    this.briefSubscription?.unsubscribe();
    this.briefSubscription = this.campaignService
      .refineBrief(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: SSEEvent<CampaignSSEEventType>) => this.handleRefineSSEEvent(event, capturedFeedback),
        error: () => {
          this.refineStatusMessages.update((msgs) => [...msgs, 'Connection lost. Please try again.']);
          this.isRefineStreaming.set(false);
        },
        complete: () => {
          this.isRefineStreaming.set(false);
        },
      });
  }

  private handleRefineSSEEvent(event: SSEEvent<CampaignSSEEventType>, feedback: string): void {
    switch (event.type) {
      case 'status':
        this.refineStatusMessages.update((msgs) => [...msgs, event.data as string]);
        break;
      case 'copy_token':
        this.copyBuffer.update((buf) => buf + (event.data as string));
        break;
      case 'copy_structured': {
        const raw = event.data as Record<string, unknown>;
        const nested = raw['platforms'] as Record<string, unknown> | undefined;
        if (nested) {
          for (const [key, value] of Object.entries(nested)) {
            if (!(key in raw)) raw[key] = value;
          }
          delete raw['platforms'];
        }
        this.structuredCopy.set(raw);
        break;
      }
      case 'copy_done':
        break;
      case 'keywords':
        this.keywords.set(event.data as CampaignKeyword[]);
        break;
      case 'linkedin_strategy':
        break;
      case 'error':
        this.refineStatusMessages.update((msgs) => [...msgs, event.data as string]);
        this.isRefineStreaming.set(false);
        break;
      case 'done':
        this.lastAppliedFeedback.set(feedback);
        this.refineCount.update((n) => n + 1);
        this.isRefineStreaming.set(false);
        this.isRefining.set(false);
        this.refineFeedback.set('');
        break;
    }
  }

  // === Private Methods ===
  private getLinkedInCopy(): LinkedInBriefCopy | undefined {
    if (!this.selectedPlatforms().has('linkedin-ads')) return undefined;
    const liCopy = this.linkedInSponsoredCopy();
    const strategy = this.linkedInStrategy();
    const variants: LinkedInCreativeVariant[] = [];
    if (liCopy) {
      const rawVariants = liCopy['variants'];
      for (const v of (Array.isArray(rawVariants) ? rawVariants : []) as Record<string, unknown>[]) {
        if (!v || typeof v !== 'object') continue;
        const introRaw = v['intro_text'] ?? v['introText'] ?? '';
        const headlineRaw = v['headline'] ?? '';
        const imageRaw = v['image_urn'] ?? v['imageUrn'];
        variants.push({
          introText: typeof introRaw === 'string' ? introRaw : String(introRaw),
          headline: typeof headlineRaw === 'string' ? headlineRaw : String(headlineRaw),
          imageUrn: typeof imageRaw === 'string' ? imageRaw : undefined,
        });
      }
    }
    const recommendedGeos: LinkedInGeoTarget[] = [];
    const rawGeos = liCopy?.['resolved_geo_targets'];
    if (Array.isArray(rawGeos)) {
      for (const g of rawGeos) {
        if (g && typeof g === 'object' && typeof g['label'] === 'string' && typeof g['urn'] === 'string') {
          recommendedGeos.push({ label: g['label'], urn: g['urn'] });
        }
      }
    }
    const profile: LinkedInTargetingProfile =
      (liCopy?.['recommended_targeting_profile'] as LinkedInTargetingProfile) ?? strategy?.targetingProfile ?? 'cloud-native';
    return {
      variants,
      recommendedGeoTargets: recommendedGeos,
      recommendedTargetingProfile: profile,
      strategy: strategy ?? undefined,
    };
  }

  /**
   * Record what the brief lookup found.
   *
   * `null` is the transport failure `catchError` mapped — distinct from every `status` the
   * server can report, and the only one that means "we do not know".
   */
  private applySavedBrief(result: CampaignBriefLoadResult | null): void {
    if (result === null) {
      this.savedBrief.set(null);
      this.savedBriefId = null;
      this.savedBriefWarning.set('Could not check whether this event already has a saved brief.');
      return;
    }

    // The id travels WITH the brief, because the parent needs it to prove ownership on the next
    // save (LFXV2-3200). Kept in step with `savedBrief` — set together, cleared together — so
    // there is no state where an offer exists without the id that authorises replacing its row.
    this.savedBrief.set(result.status === 'loaded' ? result.brief : null);
    this.savedBriefId = result.status === 'loaded' ? result.briefId : null;

    this.savedBriefWarning.set(this.warningFor(result));
  }

  /**
   * The banner text for a completed lookup, or `null` when there is nothing to say.
   *
   * Split out of `applySavedBrief` because the two cases do not nest: they are independent
   * properties of the stored row, not a refinement of one another.
   */
  private warningFor(result: CampaignBriefLoadResult): string | null {
    // NOT "will replace it" any more. An unreadable brief cannot be restored, so the page can
    // never hold its id — and without the id the save is refused as unowned (LFXV2-3200). The old
    // wording promised an outcome the guard now prevents, which is worse than saying nothing: a
    // user who wanted to start over would generate, be refused, and have no idea why.
    if (result.status === 'unreadable') {
      return 'This event has a saved brief that could not be opened, so a new one cannot be saved over it. Ask an administrator to remove the stored brief.';
    }

    // A stored brief that never reached `approved` is a save whose approve step failed. It is
    // durable, so restoring it is safe and correct, but campaign creation and audience building
    // both gate on `approved` — a silent restore would hand the user a brief that cannot proceed
    // and give no reason. Restoring cannot fix it here: approval is a separate upstream call with
    // no route on this service yet, and re-SAVING would rewrite the stored bytes with
    // `fromBriefResponse`'s lossy reconstruction, which is the one outcome the restore path
    // exists to avoid. So this says what is wrong rather than pretending it is fine. The
    // approve-only endpoint is tracked as LFXV2-3205.
    if (result.status === 'loaded' && !result.approved) {
      return 'This event has a saved brief that was never approved, so campaigns cannot be created from it yet. Restore it to review, then ask an administrator to approve the stored brief.';
    }

    return null;
  }

  private extractEventName(url: string): string {
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      const slug = pathname.split('/').pop() ?? '';
      return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      return '';
    }
  }

  private extractSlug(url: string): string {
    try {
      const pathname = new URL(url).pathname.replace(/\/+$/, '');
      return pathname.split('/').pop() ?? '';
    } catch {
      return '';
    }
  }

  private lookupHubSpot(eventName: string): void {
    if (this.lastLookedUpEvent === eventName) return;
    this.lastLookedUpEvent = eventName;
    this.hsSearching.set(true);
    this.hsStatus.set(null);
    this.hsMatches.set([]);
    this.hsNotFound.set(false);
    this.hsUtm.set(null);

    const capturedEvent = eventName;
    this.campaignService
      .lookupHubSpotUtm(eventName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: HubSpotUtmLookupResult | null) => {
          if (this.lastLookedUpEvent !== capturedEvent) return;
          if (result?.found && result.hs_utm) {
            this.hsUtm.set(result.hs_utm);
            this.hsMatches.set(result.all_matches ?? []);
            this.hsStatus.set(`Found: ${result.campaign_name}`);
          } else {
            this.hsNotFound.set(true);
            this.hsStatus.set('No matching campaign in HubSpot');
          }
          this.hsSearching.set(false);
        },
        error: () => {
          if (this.lastLookedUpEvent !== capturedEvent) return;
          this.hsStatus.set('HubSpot lookup failed');
          this.hsSearching.set(false);
        },
      });
  }

  private handleSSEEvent(event: SSEEvent<CampaignSSEEventType>): void {
    switch (event.type) {
      case 'status':
        this.statusMessages.update((msgs) => [...msgs, event.data as string]);
        break;
      case 'event':
        this.eventDetails.set(event.data as CampaignEventDetails);
        break;
      case 'copy_token':
        this.copyBuffer.update((buf) => buf + (event.data as string));
        break;
      case 'copy_structured': {
        const raw = event.data as Record<string, unknown>;
        const nested = raw['platforms'] as Record<string, unknown> | undefined;
        if (nested) {
          for (const [key, value] of Object.entries(nested)) {
            if (!(key in raw)) raw[key] = value;
          }
          delete raw['platforms'];
        }
        this.structuredCopy.set(raw);
        break;
      }
      case 'hubspot_utm': {
        const utmData = event.data as { hsUtm?: string } | string;
        this.hsUtm.set(typeof utmData === 'string' ? utmData : (utmData?.hsUtm ?? null));
        break;
      }
      case 'copy_done':
        break;
      case 'keywords':
        this.keywords.set(event.data as CampaignKeyword[]);
        break;
      case 'linkedin_strategy': {
        const raw = event.data as Record<string, unknown>;
        const rawBudget = (raw['budget_recommendation'] ?? {}) as Record<string, unknown>;
        const rawSkills = raw['recommended_skills'];
        const rawGroups = raw['recommended_groups'];
        const rawJobFunctions = raw['recommended_job_functions'];
        const rawGeoTargets = raw['geo_targets'];
        this.linkedInStrategy.set({
          targetingProfile: (raw['targeting_profile'] as LinkedInTargetingProfile) ?? 'cloud-native',
          targetingRationale: (raw['targeting_rationale'] as string) ?? '',
          recommendedSkills: Array.isArray(rawSkills) ? (rawSkills as string[]) : [],
          recommendedGroups: Array.isArray(rawGroups) ? (rawGroups as string[]) : [],
          recommendedJobFunctions: Array.isArray(rawJobFunctions) ? (rawJobFunctions as string[]) : [],
          geoTargets: Array.isArray(rawGeoTargets)
            ? (rawGeoTargets as unknown[]).filter(
                (g): g is { name: string; rationale: string } =>
                  !!g &&
                  typeof g === 'object' &&
                  typeof (g as Record<string, unknown>)['name'] === 'string' &&
                  typeof (g as Record<string, unknown>)['rationale'] === 'string'
              )
            : [],
          budgetRecommendation: {
            dailyBudgetUsd: this.safeNumber(rawBudget['daily_budget_usd'] ?? rawBudget['dailyBudgetUsd']),
            lifetimeBudgetUsd: this.safeNumber(rawBudget['lifetime_budget_usd'] ?? rawBudget['lifetimeBudgetUsd']),
            rationale: (rawBudget['rationale'] as string) ?? '',
          },
          audienceEstimate: (raw['audience_estimate'] as string) ?? '',
          campaignStructureNotes: (raw['campaign_structure_notes'] as string) ?? '',
        });
        break;
      }
      case 'error':
        this.errorMessage.set(event.data as string);
        this.step.set('input');
        break;
      case 'done':
        this.step.set('review');
        break;
    }
  }

  private safeNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
}
