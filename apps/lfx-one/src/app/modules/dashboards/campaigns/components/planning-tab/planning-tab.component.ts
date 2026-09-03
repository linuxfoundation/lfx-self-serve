// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { CAMPAIGN_GOALS, CAMPAIGN_PLATFORMS } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, skip, Subject, Subscription, switchMap, take } from 'rxjs';

import type {
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefRefineRequest,
  CampaignDeliveryType,
  CampaignEventDetails,
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

/**
 * Statuses that PROVE the create never reached HubSpot.
 *
 * A boundary refusal: 400/404 are answered by the service before it dispatches, and 401/403 by
 * `requireCampaignManager` before the request reaches the controller at all. Nothing was created,
 * so Create can safely stay on offer.
 *
 * Every other status -- transport failure, 408, any 5xx, and anything unrecognised -- leaves the
 * outcome UNKNOWN and must fail closed, because a non-idempotent create that may have landed
 * cannot be retried safely. A malformed 2xx body, for one, surfaces as 500 with the campaign
 * already created.
 *
 * Defined ONCE because it is asked twice -- "should this be recorded as possibly-created?" and
 * "what do we tell the operator?" -- and the two lists drifted apart when they were written
 * separately: 401/403 were definite for the record and unconfirmed for the message, so an
 * authorization refusal correctly wrote no record while still telling the operator the campaign
 * might exist and withdrawing Create.
 */
const isDefiniteRefusal = (status: number): boolean => status === 400 || status === 401 || status === 403 || status === 404;

type PlanningStep = 'input' | 'generating' | 'review';

@Component({
  selector: 'lfx-planning-tab',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, NgClass],
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
   * expensive ones: the event URL, the scrape, the goal/audience/value-prop inputs and the SSE
   * generation stream — which is why this is one component rather than a ~800-line fork
   * maintained twice.
   *
   * What DIFFERS grew past the "one card and one rule" this comment used to claim. Email mode:
   *   - hides the Ad Channels and Budget cards
   *   - drops the ad-platform requirement from `canGenerate`
   *   - sends `deliveryType` so the server skips ad-copy and keyword generation
   *   - hides Refine / Edit / Copy All, and refuses a refine outright
   *   - skips the saved-brief lookup entirely
   *
   * That last one is worth stating plainly: brief save/restore is NOT shared. Persistence is keyed
   * on `(foundation, event)` with no delivery type, so the row a lookup would find is a PAID
   * brief. Email persistence and email refinement do not exist yet — they arrive with the
   * `email-copy` endpoint under LFXV2-3198. Do not build on the assumption that they do.
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
  public readonly restoreSavedBriefRequested = output<{ brief: CampaignBriefOutput; briefId: string; etag: string | null; approved: boolean }>();

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

  /**
   * Email-brief editing (LFXV2-2770).
   *
   * An email brief comes back as event details and a UTM token — no `structuredCopy`, which is
   * why the paid Edit entry point is hidden for email. But the SCRAPE is what gets things wrong
   * (a wrong date, a venue that reads oddly, an audience the page never stated), and those are
   * exactly the fields the generator is instructed to use verbatim. Without an editor the only
   * remedy is to fix the event page and re-scrape.
   *
   * Held as a separate draft rather than mutating `eventDetails` in place, so Cancel restores
   * what the scrape actually returned rather than the last thing typed.
   */
  protected readonly isEditingEmailBrief = signal<boolean>(false);

  /**
   * The email brief editor, as a FormGroup rather than six signals.
   *
   * `frontend-checklist.md` 14.1 makes the `lfx-input-text` wrapper mandatory for changed form
   * controls, and the wrapper takes a FormGroup plus a control name -- `ngModel` is not supported.
   * Raw `<input>` bound to signals worked but recreated the wrapper's label/validation behaviour
   * by hand, which is the duplication the rule exists to stop.
   *
   * `countryCode` is here for a reason the others are not: it became editable when the fallback
   * stopped inventing 'US'. An extraction that produces nothing now leaves it empty -- the honest
   * answer -- but without a field to correct it an operator could not build a country-scoped
   * audience at all. The fields beside it were already repairable; this one carried the
   * consequence.
   */
  protected readonly emailEditForm = this.fb.group({
    name: [''],
    dates: [''],
    city: [''],
    countryCode: [''],
    audience: [''],
    registrationUrl: [''],
  });
  protected readonly copyBuffer = signal('');
  protected readonly structuredCopy = signal<Record<string, unknown> | null>(null);
  protected readonly hsUtm = signal<string | null>(null);
  protected readonly hsSearching = signal(false);
  protected readonly hsCreating = signal(false);
  /**
   * A create POST is in flight SOMEWHERE, regardless of which foundation the panel now shows.
   *
   * Distinct from `hsCreating`, which is rendering state and is cleared on a foundation switch so
   * the new panel does not inherit the old one's spinner. Clearing it there also freed the
   * button, and the switch's own lookup can answer "not found" while the original POST is still
   * committing -- so a second click dispatched a SECOND create. When both projects resolve to the
   * same HubSpot portal that is a duplicate campaign in a shared namespace, which cannot be
   * removed from this UI.
   *
   * A COUNTER rather than a boolean: two creates can legitimately overlap across a switch, and a
   * boolean cleared by the first to settle would re-open the button while the second is still
   * running. The offer returns only when the count reaches zero.
   */
  private readonly hsCreatesInFlight = signal(0);
  /**
   * Whether the Create control must stay disabled. Either this panel is creating, or a create
   * dispatched BEFORE a foundation switch has not settled yet.
   */
  /**
   * Events a create MAY have made a campaign for, keyed `foundation|event`.
   *
   * Written by both arms: a confirmed `created: true`, and any create failure that is not a
   * definite refusal, where the POST may still have committed. `hsCreatedConfirmed` below marks
   * which -- suppression treats them alike, the status line does not.
   *
   * A superseded create still makes a real campaign upstream. Discarding its result for
   * RENDERING is right -- the operator moved on -- but forgetting it happened let the panel
   * re-offer Create for an event that now has one, and two projects on the same HubSpot portal
   * share that namespace.
   *
   * Keyed `foundation|event`, and NOT cleared on a foundation switch. Both halves are load-
   * bearing, and I got each of them wrong once:
   *
   *   - keyed by EVENT ALONE, a create under portal A withheld Create for that event name under
   *     every other portal, above a false "Created in HubSpot" status. The re-check reads the new
   *     portal, never finds it, and cannot clear the record -- unrecoverable (dealako, round 4).
   *   - CLEARED on switch, the round-trip case reopens: dispatch under A, switch to B, the
   *     superseded create succeeds, switch back to A, and the record is gone -- so Create is
   *     offered for a campaign that exists.
   *
   * Keying by foundation and retaining across switches satisfies both: the record only ever
   * suppresses Create under the foundation the create was made from, and returning there still
   * finds it.
   *
   * TWO FOUNDATIONS ON ONE PORTAL is handled by `hsCreatedEventNames` below, NOT by this set,
   * and NOT by the in-flight guard -- an earlier version of this note claimed the latter and was
   * wrong. `hsCreatesInFlight` falls to zero when the POST settles, and the duplicate window is
   * HubSpot's INDEXING lag, which begins there. The two windows are adjacent, not overlapping.
   *
   * (Still true: no lookup or create response carries a portal id, so keying on the portal
   * itself is not available to this component. See `hsCreatedEventNames` for what is done
   * instead.)
   */
  private readonly hsCreatedEvents = signal(new Set<string>());

  /**
   * Event NAMES a create has succeeded for, under any foundation.
   *
   * Two foundations can share one HubSpot portal, and campaign names live in one namespace per
   * portal. So a create under A means an event-named campaign may exist for an operator now
   * standing in B -- and B's own lookup can legitimately come back empty while HubSpot indexes.
   *
   * This deliberately does NOT suppress Create, which is what made an event-only key
   * unrecoverable in dealako's round 4: a create under portal A withheld Create for that name
   * under every OTHER portal, permanently, because the re-check reads the new portal and can
   * never clear the record.
   *
   * It does exactly one thing: turns a would-be confident "No campaign found" into the honest
   * UNCONFIRMED reading, so the operator is told the name may already be taken on this portal
   * and can check before creating. Create stays available -- a different foundation may well be
   * a different portal, and refusing there is the round-4 lockout.
   *
   * Never cleared. The window it describes is unbounded (indexing lag has no stated ceiling) and
   * it costs one extra sentence in a status line, not a blocked control.
   */
  private readonly hsCreatedEventNames = signal(new Set<string>());

  /**
   * The subset of `hsCreatedEvents` keys whose create was CONFIRMED -- the response said so.
   *
   * The record is written from two arms that know very different things. The success arm saw
   * `created: true`, so a campaign exists and is merely unindexed. The error arm writes on any
   * status that is not a definite refusal, where nothing may have happened at all.
   *
   * Without this distinction the re-check branch told both stories as "Created, but HubSpot has
   * not indexed it yet" -- asserted as fact. For the transport-503 class that is the very harm
   * the error arm warns about: sending an operator to check HubSpot for a campaign that was
   * never attempted (dealako, round 6).
   *
   * Suppression does not read this. Both classes still block Create, because an unconfirmed
   * create may have landed. It changes only what the operator is TOLD.
   */
  private readonly hsCreatedConfirmed = signal(new Set<string>());

  /**
   * The subset of `hsCreatedEventNames` whose create was CONFIRMED.
   *
   * Separate from `hsCreatedConfirmed` because that one is keyed `foundation|event` and this
   * question is asked from a DIFFERENT foundation, where that key cannot match. Same distinction,
   * different lookup.
   */
  private readonly hsCreatedNamesConfirmed = signal(new Set<string>());
  /**
   * How many times a re-check has come back EMPTY for a possibly-created event.
   *
   * The record needs an EXIT, because it is written on unconfirmed failures too -- and an
   * unconfirmed failure includes the case where the request never left the BFF, so nothing was
   * created and nothing ever will appear. Without one, that permanently withheld Create under a
   * false "Created in HubSpot", recoverable only by reload (dealako, round 5). "Expire" is the
   * wrong word for it: the record is cleared by EVIDENCE, never by elapsed time or attempts.
   *
   * The exit is a POSITIVE find, not a miss count -- see `retireCreatedRecord`. An earlier
   * revision retired the record after two empty re-checks; that could never be correct, because
   * an empty search under an eventually-consistent index proves lag, not absence.
   */
  /**
   * The event the panel is currently showing, as a SIGNAL.
   *
   * `lastLookedUpEvent` is a plain field, and a computed reading it never re-evaluates when it
   * changes -- a guard built that way is silently dead. Mirrored here by the one setter below so
   * hsCreateBlocked can depend on it honestly.
   */
  private readonly currentEvent = signal('');
  protected readonly hsCreateBlocked = computed(
    () => this.hsCreating() || this.hsCreatesInFlight() > 0 || this.hsCreatedEvents().has(`${this.activeFoundationSlug()}|${this.currentEvent()}`)
  );
  protected readonly hsStatus = signal<string | null>(null);
  protected readonly hsNotFound = signal(false);
  /**
   * A create whose outcome could not be established.
   *
   * Distinct from a plain status string because it drives a CONTROL, not just copy: it is the
   * one state in which the create offer has been withdrawn but the operator still has work to
   * do, and a re-check is the only action that can resolve it.
   */
  protected readonly hsUnconfirmed = signal(false);
  /**
   * "Not found" was not established, so the create offer is withheld. Carries `inconclusive`.
   *
   * Deliberately does NOT claim the lookup missed rows. `inconclusive` is
   * `capped || campaigns.length > 0`, so it is equally true when HubSpot returned EVERYTHING and
   * only the local scorer rejected the rows — an earlier version of this doc asserted the
   * truncation, which is false in exactly that case and is the claim the signal one below now
   * repudiates.
   *
   * Either way the consequence is the same and is why the offer is withheld: creating on a
   * search that did not establish absence duplicates a campaign in the LF-global namespace every
   * foundation shares, and the duplicate cannot be removed from this UI.
   */
  protected readonly hsCreateSuppressed = signal(false);
  /**
   * The search could not be SHOWN to be complete. Carries the wire field `capped`.
   *
   * Deliberately NOT named for truncation. campaign-service's contract (design/connection.go)
   * defines `capped` as "true when the search could NOT be shown to be complete", which covers
   * HubSpot reporting more matches than it returned AND the cases where completeness is simply
   * unknown — an absent `total`, or one that contradicts the rows. All fail CLOSED.
   *
   * I renamed this to `hsHubSpotTruncated` once, on the belief that `capped` meant truncation on
   * the wire. It does not, and the rename made the signal name assert more than the response
   * establishes. Reverted; the status line it feeds must not claim truncation either.
   *
   * Separate from `hsCreateSuppressed` because the remedies differ: an unproven-completeness
   * result asks for a narrower term, while a result HubSpot returned in FULL whose rows the local
   * scorer rejected asks the operator to check the name.
   */
  protected readonly hsCompletenessUnproven = signal(false);
  protected readonly hsMatches = signal<{ name: string; hs_utm: string }[]>([]);
  /**
   * Whether the match picker has anything to offer.
   *
   * NOT `hsMatches().length > 1`. That threshold assumed the selected match was always IN the
   * list, so "more than one" meant "at least one alternative". It no longer is: `all_matches`
   * can only carry campaigns that HAVE a token, so when the best match is tokenless it is
   * excluded — and a single tokened alternative left the list at length 1 and stayed hidden,
   * with no way for the user to take the one token actually available.
   *
   * The real question is whether any listed match is not the one already selected.
   */
  protected readonly hsHasAlternatives = computed(() => this.hsMatches().some((m) => m.hs_utm !== this.hsUtm()));
  protected readonly keywords = signal<CampaignKeyword[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly linkedInStrategy = signal<LinkedInTargetingStrategy | null>(null);
  private lastLookedUpEventValue = '';
  /**
   * The event the last lookup answered for.
   *
   * A property with a SETTER, not a bare field: `currentEvent` must stay in step with it or the
   * create-block computed reads a stale value, and three separate call sites writing both by
   * hand is exactly the drift that produces a guard which silently never fires. Writing one
   * writes the other, by construction.
   */
  protected get lastLookedUpEvent(): string {
    return this.lastLookedUpEventValue;
  }
  protected set lastLookedUpEvent(value: string) {
    this.lastLookedUpEventValue = value;
    this.currentEvent.set(value);
  }
  /**
   * Monotonic id for the in-flight create, identifying which one owns `hsCreating`.
   *
   * A counter rather than a captured value: the foundation and the event can both come BACK
   * (A -> B -> A), and an older create matching again would release a flag a newer one holds,
   * re-enabling the button under a running request. This only advances.
   */
  private createGeneration = 0;
  /**
   * The same monotonic id for the in-flight LOOKUP. Identical reasoning to createGeneration:
   * an A -> B -> A round trip while an A lookup is in flight leaves the old response matching
   * on event AND foundation, so it would pass an equality check and overwrite the newer one.
   */
  private lookupGeneration = 0;
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

  /**
   * The ETag the lookup observed for that brief, carried so the restore can hand the parent a
   * LAST-SEEN validator rather than none (LFXV2-3204).
   *
   * Kept in step with `savedBrief` exactly as the id is, so there is no state where a brief is
   * offered alongside a validator belonging to a different row. May legitimately be `null` — a
   * read that produced no ETag still yields a restorable brief — so the restore stays possible
   * without one and the parent decides what an absent validator permits.
   */
  private savedBriefEtag: string | null = null;

  /**
   * Whether that stored brief is APPROVED, carried alongside its id.
   *
   * The restore emits it because campaign-service refuses a create from an unapproved brief
   * (`internal/service/brief.go:439`). Without it the parent files a restored brief as
   * create-ready and the Implementation tab enables Create for a request that cannot succeed —
   * the same defect the save path already guards, one restore apart.
   */
  private savedBriefApproved = false;

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
        // Paid only, and gated at the SOURCE rather than by hiding the banner.
        //
        // Brief persistence is keyed on `(foundation, event)` with no delivery type, so the row
        // this finds is a PAID brief — offering it under Email would restore RSA headlines and a
        // keyword list into an email plan. The email host also binds no `restoreSavedBriefRequested`
        // handler, so Restore emitted into nothing and the click did nothing at all.
        //
        // Not merely a hidden banner: suppressing the request too means no `loadBrief` call per
        // keystroke-debounce for a result that can never be used. Delivery-aware persistence is
        // LFXV2-3198's to introduce, together with the email brief shape it would store.
        filter(() => !this.isEmail()),
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
      this.savedBriefEtag = null;
      this.savedBriefApproved = false;
      this.savedBriefWarning.set(null);
      // The HubSpot state is cleared too, and the stale-response guard is not enough on its own.
      // That guard stops a LATE answer from landing; it does nothing about an answer that
      // already landed. campaign-service selects the HubSpot connection BY PROJECT, so once the
      // foundation changes, a token found under A is an answer to a question nobody asked about
      // B — and the url field does not change, so nothing else re-runs the lookup.
      //
      // Left in place, A's token stays in the field and rolls into B's brief, and A's Create
      // button stays live against B's portal. `lastLookedUpEvent` is cleared as well so the
      // early return cannot swallow the re-lookup for the same event under the new foundation.
      this.lastLookedUpEvent = '';
      this.hsUtm.set(null);
      this.hsMatches.set([]);
      this.hsNotFound.set(false);
      this.hsCreateSuppressed.set(false);
      this.hsCompletenessUnproven.set(false);
      this.hsUnconfirmed.set(false);
      this.hsStatus.set(null);
      this.hsSearching.set(false);
      this.hsCreating.set(false);
      // hsCreatedEvents is NOT cleared here, and is keyed foundation|event so it does not need
      // to be. See its own doc: clearing lost the round-trip protection, while an event-only key
      // withheld Create permanently under every other portal.
      // INVALIDATE anything already in flight. Clearing hsCreating frees the button but leaves
      // an in-flight create still matching createIsCurrent, so after an A -> B -> A switch its
      // answer renders on a panel it was never asked about — and a stale not-found re-offers a
      // create for a campaign that may exist. The lookup below advances lookupGeneration on its
      // own; the create has no equivalent restart, so it is bumped here.
      this.createGeneration++;
      // And RE-ASK the question under the new foundation. Clearing alone left the panel dead:
      // the component stays mounted and the url does not change, so `urlInput$` never fires and
      // nothing else starts a lookup — the whole HubSpot block stayed hidden, with no create and
      // no re-check, until the operator retyped the same url. The event is still in the field,
      // and it is a different question now that a different portal answers it.
      const eventName = this.extractEventName(this.briefForm.controls.url.value.trim());
      // Same length gate `onUrlInput` applies before it will issue a lookup at all: a short or
      // half-typed url names no event, and asking about one would be a request nobody made.
      if (eventName.length > 3) {
        this.lookupHubSpot(eventName);
      }
    });
  }

  // === Public Methods ===
  public reset(): void {
    this.briefSubscription?.unsubscribe();
    this.briefSubscription = null;
    this.step.set('input');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.isEditingEmailBrief.set(false);
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
    // `savedBriefId` and `savedBriefEtag` are left in step with `savedBrief` by saying nothing
    // about any of them — the three are only ever written together, which is what
    // `restoreSavedBrief`'s both-or-neither guard depends on, and what stops a validator
    // outliving the brief it was read for.
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
        this.savedBriefEtag = null;
        this.savedBriefApproved = false;
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
      this.restoreSavedBriefRequested.emit({ brief, briefId: this.savedBriefId, etag: this.savedBriefEtag, approved: this.savedBriefApproved });
    }
  }

  protected selectHsMatch(hsUtm: string, name: string): void {
    this.hsUtm.set(hsUtm);
    this.hsStatus.set(`Selected: ${name}`);
  }

  /**
   * Re-run the HubSpot lookup for the event already in the field.
   *
   * This exists because an unconfirmed create WITHDRAWS the create offer — the campaign may
   * already have been written, so re-offering it would invite a duplicate in a namespace every
   * foundation shares. That leaves a fresh lookup as the only way to establish what actually
   * happened, and `lookupHubSpot` returns early while the event is unchanged, so retyping the
   * same url is a no-op. Without this control the operator is told to check HubSpot and try
   * again with nothing on the page able to try.
   */
  protected recheckHubSpot(): void {
    const event = this.lastLookedUpEvent;
    if (!event || this.hsSearching() || this.hsCreating()) return;
    // Cleared so lookupHubSpot's own early return does not swallow this deliberate re-check.
    this.lastLookedUpEvent = '';
    this.lookupHubSpot(event);
  }

  protected createInHubSpot(): void {
    if (!this.lastLookedUpEvent) return;
    // Refused in the METHOD too, not only via [disabled]. A disabled attribute is a rendering
    // concern -- it can be bypassed, and a foundation switch re-enables the control the moment it
    // clears hsCreating -- while a duplicate campaign in a shared HubSpot portal cannot be undone
    // from this UI. The dispatch itself has to hold the line.
    if (this.hsCreatesInFlight() > 0) return;
    // Refuse when the field no longer names the event this offer was raised for. The button
    // survives a url edit because the HubSpot state is not reset until the 500ms debounced
    // lookup STARTS — so between typing and that debounce, the offer on screen belongs to the
    // previous event. Acting on it would create a campaign for an event the operator has left,
    // in a namespace nobody can clean up from this UI.
    //
    // Same shape as restoreSavedBrief's guard: keep the offer visible through a mid-edit url,
    // but only ever act on it while the field still names its own event.
    if (!this.panelStillShows(this.lastLookedUpEvent, this.activeFoundationSlug())) {
      return;
    }
    // The EMPTY/short field is refused on top of that, which panelStillShows deliberately does
    // not do. Keeping the captured event through a mid-edit url is right for deciding whether an
    // in-flight ANSWER may still be rendered — but "the field names nothing yet" is not
    // permission to perform an irreversible write into a namespace shared portal-wide.
    // restoreSavedBrief draws the same line. The offer stays VISIBLE either way; only acting on
    // it is refused, so a user who clears the field mid-edit loses nothing by retyping.
    if (this.extractEventName(this.briefForm.controls.url.value.trim()).length <= 3) {
      return;
    }
    this.hsCreating.set(true);
    // Counted separately so a foundation switch cannot free the button under a live POST.
    this.hsCreatesInFlight.update((n) => n + 1);
    this.hsStatus.set(null);
    // Captured for the same reason the lookup captures it: the create is slow enough for the
    // operator to retype the url and start a lookup for a DIFFERENT event while it is in flight.
    // Without this, a create for event A writes A's token into event B's panel, or withdraws the
    // create offer B's own lookup just raised.
    const capturedEvent = this.lastLookedUpEvent;
    const capturedFoundation = this.activeFoundationSlug();
    const generation = ++this.createGeneration;
    this.campaignService
      .createHubSpotUtm(capturedFoundation, capturedEvent)
      .pipe(
        // `take(1)`, NOT `takeUntilDestroyed` -- the same call the optimization tab's keyword
        // mutations make, for the same reason. This is a NON-IDEMPOTENT create against a
        // portal-wide namespace: binding it to the view meant navigating away aborted the request
        // mid-flight, so neither arm recorded the outcome even though campaign-service may
        // already have created the campaign. Returning before HubSpot indexes it then re-offered
        // Create -- the duplicate this whole component guards against, reached by leaving the
        // page (Copilot).
        //
        // `take(1)` still bounds the subscription: an HttpClient request is finite and
        // self-completing, so nothing leaks. It just does not CANCEL.
        //
        // WHAT THIS DOES AND DOES NOT BUY, since an earlier version of this comment claimed more
        // than it delivers: the outcome arm now runs, so a create that lands is recorded on THIS
        // instance and cannot be re-offered while the panel lives. It does NOT survive a REMOUNT
        // -- the record sets are instance signals, and this component sits inside an `@for`
        // tracked by `selectedProgramType()`, so switching program type destroys it and the new
        // instance starts empty (Copilot).
        //
        // Closing that needs the possibly-created state in a longer-lived service, or upstream
        // idempotency (#2086), which would make all of this unnecessary. Deliberately NOT done
        // here: session-scoping this state is a different change with its own lifetime questions,
        // and this PR is already several rounds deep.
        take(1),
        // finalize, not the two arms, so the count cannot leak. next/error cover every outcome
        // this service produces today, but a completion without emission would leave the create
        // counted forever and permanently withdraw the offer -- a worse failure than the
        // duplicate it guards against, because nothing would recover it short of a reload.
        finalize(() => this.hsCreatesInFlight.update((n) => Math.max(0, n - 1)))
      )
      .subscribe({
        next: (result) => {
          // Released before the render guard, but only by the create that still owns the flag.
          // Ordering matters because returning first left the button disabled and "Creating..."
          // frozen on the new event's panel forever; ownership matters because releasing
          // unconditionally lets an OLDER create re-enable the button while a newer one is
          // still running, which is how a duplicate gets made.
          if (this.createIsCurrent(generation)) {
            this.hsCreating.set(false);
          }
          // Recorded BEFORE the ownership guards, deliberately. A superseded create still made a
          // real campaign upstream; discarding its RESULT is right, but forgetting it happened
          // let the panel re-offer Create for an event that now has one.
          // EVERY emitted response records a possibly-created campaign, not just a truthy
          // `created`. A response that arrived but did not say so -- a malformed body, a missing
          // flag -- is exactly the "may or may not have been created" case the else arm below
          // already tells the operator about, and it was writing no record at all. A later empty
          // lookup then found nothing and restored Create, so a POST that DID commit could be
          // duplicated by the very message warning about it (Copilot).
          //
          // The confirmed marker still requires the flag: recording possibly-created is a
          // suppression decision, saying "Created" is a claim about fact.
          this.hsCreatedEvents.update((seen) => new Set(seen).add(`${capturedFoundation}|${capturedEvent}`));
          this.hsCreatedEventNames.update((seen) => new Set(seen).add(capturedEvent));
          if (result?.created) {
            this.hsCreatedConfirmed.update((seen) => new Set(seen).add(`${capturedFoundation}|${capturedEvent}`));
            this.hsCreatedNamesConfirmed.update((seen) => new Set(seen).add(capturedEvent));
          }
          // RECONCILE THE PANEL the record just contradicted, before the ownership guards drop
          // this result.
          //
          // The records above are written unconditionally, deliberately -- a superseded create
          // still made a real campaign. But a lookup that already returned not-found has left
          // `hsNotFound` true, and the new record makes `hsCreateBlocked` true too. That pair is
          // a dead end: a disabled Create button beneath "No campaign found", with no re-check
          // offered, recoverable only by reloading the page.
          //
          // Reached by an ordinary A -> B -> A round trip where the stale create settles after
          // the replacement lookup returned. Narrow on purpose: only when the record the stale
          // create just wrote is the one the CURRENT panel would read. Anything else is a result
          // for a panel the operator has left, and still belongs to the guards below.
          this.reconcilePanelAfterStaleCreate();
          // Generation first, then panelStillShows — the same pair the lookup arms use. An
          // A -> B -> A round trip makes panelStillShows match a SUPERSEDED create again, and
          // rendering its result would write a token from a create the operator has moved past.
          if (!this.createIsCurrent(generation)) return;
          if (!this.panelStillShows(capturedEvent, capturedFoundation)) return;
          // `created` alone decides success. HubSpot assigns the token, and not necessarily by
          // the time the create returns — so requiring hs_utm too would report a campaign that
          // WAS created as a failure, leave the Create button up, and invite a retry that writes
          // a SECOND campaign into the LF-global namespace. Upstream refuses an id-less create
          // rather than reporting one as success, so `created` is trustworthy on its own.
          if (result?.created) {
            if (result.hs_utm) {
              this.hsUtm.set(result.hs_utm);
            }
            this.hsNotFound.set(false);
            // The re-check stays available when the response carried no token. That does NOT
            // establish that HubSpot has not assigned one — the marketing create is not
            // documented to return `hs_utm` at all — so a re-read is exactly what settles it,
            // and lookupHubSpot's early return means retyping the same url cannot. Create stays
            // hidden either way (hsNotFound is false), so this offers the ONE action that can
            // still make progress rather than a dead end.
            this.hsUnconfirmed.set(!result.hs_utm);
            this.hsStatus.set(
              result.hs_utm
                ? `Created: ${result.campaign_name}`
                : // NOT "HubSpot has not assigned one yet" — that is a guess. The marketing
                  // create is not documented to return `hs_utm`, so an absent token here means
                  // only that THIS RESPONSE did not carry one; the campaign may already have a
                  // token the very next lookup can see. Say what is known, and let the re-check
                  // establish the rest.
                  `Created: ${result.campaign_name} — its UTM token is not known yet; check again to read it back`
            );
          } else {
            // Same reasoning as the error arm: without a `created` flag the outcome is unknown,
            // so the action is withdrawn rather than offered again.
            this.hsNotFound.set(false);
            this.hsUnconfirmed.set(true);
            this.hsStatus.set('The campaign may or may not have been created — check HubSpot before trying again.');
          }
        },
        error: (err: unknown) => {
          // Recorded on an UNCONFIRMED failure too, and before the ownership guards for the same
          // reason the success arm is. A 400/404 proves nothing was created, but every other
          // outcome -- a lost connection, a timeout, a 5xx -- means the POST MAY have committed.
          // Recording only definite successes left this gap: the offered re-check can return an
          // empty result while HubSpot is still indexing the campaign that did land, and Create
          // was then re-enabled for a campaign that exists.
          //
          // Erring toward recording is right here: a spurious record withholds Create while a
          // missing one writes a duplicate nobody can delete. The record lasts the SESSION and is
          // cleared only by a lookup positively finding the campaign -- there is deliberately no
          // count-based expiry, because an empty search under an eventually-consistent index
          // proves lag, not absence. An operator whose create never landed recovers by creating
          // it in HubSpot directly, and the re-check status says so for this class rather than
          // asserting the campaign was created.
          const failStatus = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 0;
          if (!isDefiniteRefusal(failStatus)) {
            this.hsCreatedEvents.update((seen) => new Set(seen).add(`${capturedFoundation}|${capturedEvent}`));
            this.hsCreatedEventNames.update((seen) => new Set(seen).add(capturedEvent));
            // The SAME reconciliation the success arm does. This arm writes the same two records
            // and then returns on a non-current generation, so without this a 503 or timeout
            // after a foundation switch stranded the panel exactly as a stale success did
            // (cursor). Gating the repair on `created` fixed the symptom in one arm only.
            this.reconcilePanelAfterStaleCreate();
          }
          if (this.createIsCurrent(generation)) {
            this.hsCreating.set(false);
          }
          // Generation first, as on the other three arms: a superseded create's FAILURE says
          // nothing about the current one, and rendering it would withdraw a live offer or
          // strand the panel on a message belonging to a create the operator has left.
          if (!this.createIsCurrent(generation)) return;
          if (!this.panelStillShows(capturedEvent, capturedFoundation)) return;
          // The STATUS is read, not discarded. campaign-service separates the outcomes
          // deliberately, and collapsing them here would throw that away at the last step:
          //
          //   400 — HubSpot rejected it, or the connection is unusable. NOTHING was created,
          //         so the create offer stays up and the operator can correct and retry.
          //   404 — no HubSpot connection for this project. Also nothing created, but the
          //         remedy is to connect HubSpot rather than to change the name.
          //   else — UNCONFIRMED. The campaign may already exist, so the offer is WITHDRAWN and
          //         only a fresh lookup can establish what happened.
          //
          // 500 is UNCONFIRMED here, and stays that way even though campaign-service now
          // reserves 500 for pre-send faults alone (it moved "the campaign was not returned
          // after creation" to a 503). Trusting 500 as "definitely not created" would need
          // every layer in the path to honour that rule, and this UI cannot verify that from
          // here: only the service's own 500s carry the pre-send guarantee, and a status code
          // does not say who produced it. The BFF's transport failures are 503 for the same
          // reason, so the ambiguous reading costs a re-check, while being wrong the other way
          // costs a duplicate campaign nobody can remove from this UI.
          //
          // Treating every status as "may have been created" hid two actionable failures behind
          // a message telling the operator to check HubSpot for a campaign never attempted; the
          // fix must not overshoot into the opposite error.
          const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 0;
          // 400 and 404 only. 500 was here on the strength of campaign-service RESERVING it for
          // the pre-send position ("a fault discovered AFTER the create returned without error is
          // a 503", design/connection.go) -- but that contract governs what campaign-service
          // SENDS, and this status is not read from campaign-service. It is read from OUR BFF,
          // which raises its own 500 for a fault at any position: error-handler.middleware.ts:92
          // returns 500 for any non-BaseApiError, and ApiClientService parses the upstream body
          // with JSON.parse AFTER a 2xx (api-client.service.ts:305). A malformed success body
          // therefore reaches the browser as 500 with the campaign ALREADY CREATED in HubSpot.
          //
          // Re-offering Create there is the duplicate this whole handler exists to prevent, and
          // the duplicate cannot be removed from this UI. A 500 costs a re-check; a duplicate
          // costs a campaign nobody can delete. Unconfirmed is the honest reading.
          // The SAME predicate the record site asks. Listing the statuses again here is what let
          // the two drift: 401/403 counted as definite for the record and unconfirmed for the
          // message, so an authorization refusal wrote no record -- correctly -- and still told
          // the operator the campaign might exist, withdrew Create, and cost them a re-check to
          // settle something the boundary had already settled.
          if (isDefiniteRefusal(status)) {
            // Nothing was created: keep the offer so the operator can act on the message.
            this.hsUnconfirmed.set(false);
            this.hsStatus.set(this.createFailureMessage(status, err));
            return;
          }
          // Unconfirmed — including any status this code cannot classify, because a
          // non-idempotent create must fail CLOSED. Clearing hsNotFound hides the action;
          // recovering needs a fresh lookup, which is the only thing that can establish what
          // actually happened.
          this.hsNotFound.set(false);
          this.hsUnconfirmed.set(true);
          this.hsStatus.set('The campaign may or may not have been created — check HubSpot before trying again.');
        },
      });
  }

  protected generate(): void {
    if (!this.canGenerate()) return;

    this.step.set('generating');
    this.statusMessages.set([]);
    this.eventDetails.set(null);
    this.isEditingEmailBrief.set(false);
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
      .generateBrief(this.activeFoundationSlug(), request)
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
    // Same reason as the paid flush above: the emitted `eventDetails` is what generation is told
    // to use verbatim, so an editor still open here would send the UNCORRECTED scrape while the
    // user is looking at their correction on screen.
    if (this.isEditingEmailBrief()) {
      this.saveEmailEdit();
    }
    const url = this.briefForm.controls.url.value.trim();
    const fallbackName = this.extractEventName(url);
    const fallbackSlug = this.extractSlug(url);
    // Every field here is EMPTY except the name and slug, which are derived from the URL the user
    // typed. `countryCode` was 'US' -- the one invented value in an otherwise honest blank record,
    // and the one that does damage: it reaches campaign-service's audience builder as `country`,
    // so a failed extraction for a Nairobi event built a United States audience. Real, plausible,
    // and wrong, which is worse than an audience that refuses to build.
    //
    // Empty instead. `countryNameFor` maps an unknown code to '' rather than a raw code, so the
    // builder receives no country filter rather than the wrong one.
    const details: CampaignEventDetails = this.eventDetails() ?? {
      name: fallbackName,
      dates: '',
      city: '',
      countryCode: '',
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

  /** Open the email brief editor, seeded with what the scrape returned. */
  protected enterEmailEditMode(): void {
    const d = this.eventDetails();
    if (d === null) {
      return;
    }
    this.emailEditForm.setValue({
      name: d.name,
      dates: d.dates,
      city: d.city,
      countryCode: d.countryCode,
      audience: d.audience,
      registrationUrl: d.registrationUrl,
    });
    this.isEditingEmailBrief.set(true);
  }

  /**
   * Apply the edits to the brief the rest of the flow reads.
   *
   * Writes back into `eventDetails` because that is what `proceedToImplementation` emits and what
   * content generation is told to use verbatim — an edit that stopped at the form would show the
   * corrected date on screen while the generator still wrote the wrong one.
   */
  protected saveEmailEdit(): void {
    const d = this.eventDetails();
    if (d === null) {
      return;
    }
    this.eventDetails.set({
      ...d,
      name: (this.emailEditForm.controls.name.value ?? '').trim(),
      dates: (this.emailEditForm.controls.dates.value ?? '').trim(),
      city: (this.emailEditForm.controls.city.value ?? '').trim(),
      // Upper-cased: `countryNameFor` looks the code up case-sensitively after its own
      // normalisation, and an operator typing "ke" should not silently produce no country.
      countryCode: (this.emailEditForm.controls.countryCode.value ?? '').trim().toUpperCase(),
      audience: (this.emailEditForm.controls.audience.value ?? '').trim(),
      registrationUrl: (this.emailEditForm.controls.registrationUrl.value ?? '').trim(),
    });
    this.isEditingEmailBrief.set(false);
  }

  /** Discard the edits. `eventDetails` was never mutated, so nothing to restore. */
  protected cancelEmailEdit(): void {
    this.isEditingEmailBrief.set(false);
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

    // Checked BEFORE the `currentCopy` guard below, which would otherwise swallow this case.
    // An email brief generates no copy, so `structuredCopy` is null and that guard returns
    // silently — leaving a user who reached Refine (via a restored paid brief, or any future
    // caller) pressing Regenerate and watching nothing happen. Says why instead.
    if (this.isEmail()) {
      this.errorMessage.set('Refining email copy is not supported yet.');
      return;
    }

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
      // PAID-ONLY by construction: `submitRefine` returns above for email, so this request can
      // never carry `deliveryType: 'email'`. An earlier version branched on `isEmail()` here and
      // documented a server refusal it could not reach — which made the client look as though it
      // exercised that path when nothing did. The server guard stays for direct callers; this
      // sends the paid shape unconditionally.
      deliveryType: this.deliveryType(),
      platforms: [...this.selectedPlatforms()],
      programType: this.programTypeConfig().id,
    };

    this.briefSubscription?.unsubscribe();
    this.briefSubscription = this.campaignService
      .refineBrief(this.activeFoundationSlug(), request)
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
      this.savedBriefEtag = null;
      this.savedBriefApproved = false;
      this.savedBriefWarning.set('Could not check whether this event already has a saved brief.');
      return;
    }

    // The id travels WITH the brief, because the parent needs it to prove ownership on the next
    // save (LFXV2-3200). Kept in step with `savedBrief` — set together, cleared together — so
    // there is no state where an offer exists without the id that authorises replacing its row.
    this.savedBrief.set(result.status === 'loaded' ? result.brief : null);
    this.savedBriefId = result.status === 'loaded' ? result.briefId : null;
    // `?? null` NORMALISES, it does not merely satisfy the type. `etag` crosses an HTTP
    // boundary, so the declared `string | null` is a claim about the CURRENT server: during a
    // rolling deploy an older pod omits the field entirely and JSON yields `undefined`. That
    // value would then fail the restore path's `etag === null` test, withholding the
    // overwrite licence a validator-less restore is supposed to get and refusing the first
    // save after every restore as `unverified-validator` — the main path, broken for the
    // length of a deploy. Collapse absence to one spelling here, at the boundary.
    this.savedBriefEtag = result.status === 'loaded' ? (result.etag ?? null) : null;
    this.savedBriefApproved = result.status === 'loaded' && result.approved;

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

  /**
   * Whether the panel still belongs to the event `capturedEvent` was captured for.
   *
   * Compares against the LIVE url field, not `lastLookedUpEvent`. The latter only updates when
   * the 500ms debounced lookup fires, so between the user typing event B and that debounce
   * elapsing it still names event A — and a create for A landing in that window would pass a
   * `lastLookedUpEvent` check and write A's token into B's panel. The field is the earliest
   * point at which the user's intent is visible, which is what makes it the right thing to
   * compare. Same reasoning as restoreSavedBrief's guard.
   */

  /**
   * Whether this lookup is still the LATEST one, which is the only question the shared
   * `hsSearching` flag should be gated on.
   *
   * Distinct from `panelStillShows`, deliberately. That helper also asks whether the live url
   * still names the captured event — right for deciding whose ANSWER may be rendered, but wrong
   * for releasing an in-flight flag: the moment the user retypes, it goes false while the only
   * request in flight is still this one, so nothing would ever clear the spinner. Here the
   * question is narrower and is about ownership of the flag, not about what may be displayed.
   *
   * Keyed on a GENERATION rather than on the event and foundation, for the same reason
   * createIsCurrent is: both of those can come BACK. An A -> B -> A round trip while an A
   * lookup is in flight leaves the old response matching on both, so an equality check would
   * let it clear or overwrite the newer one. A counter only advances.
   */

  /**
   * The status line for a lookup that found nothing, which is three different statements.
   *
   * The first arm must NOT claim truncation. `capped` means only that completeness could not be
   * SHOWN — it is equally true when HubSpot's `total` is absent or contradicts the rows — so
   * "there are more it did not return" stated a fact the response never established. The wording
   * now reports the uncertainty itself, which is what the operator can actually act on.
   *
   * Still distinct from the third arm: a search HubSpot answered in full, whose rows the local
   * scorer rejected, is equally inconclusive but has a different remedy — check the name, rather
   * than narrow the term — and a message that conflates them sends the operator the wrong way.
   */
  private noMatchStatus(completenessUnproven: boolean, inconclusive: boolean): string {
    if (completenessUnproven) {
      return 'No match among the campaigns HubSpot returned, and the search could not be shown to be complete — narrow the search term';
    }
    if (inconclusive) {
      return 'No close match among the campaigns HubSpot returned';
    }
    return 'No matching campaign in HubSpot';
  }

  private lookupIsCurrent(generation: number): boolean {
    return this.lookupGeneration === generation;
  }

  /**
   * Whether this create still OWNS the shared `hsCreating` flag.
   *
   * The flag is shared, not per-subscription — a foundation change clears state and can start a
   * second create while the first is still in flight. An older create releasing the flag
   * unconditionally then re-enables the button while the NEWER request is still running, which
   * is how a duplicate campaign gets made in a shared namespace.
   *
   * Keyed on a GENERATION counter rather than on the foundation or the event. Both of those are
   * values that can come back: a round trip A -> B -> A leaves an old create matching the active
   * foundation again, so it would clear the flag a newer create is holding. The counter only
   * ever advances, so exactly one in-flight create owns the flag at a time, and identity does
   * not depend on state the user can navigate back to.
   */

  /**
   * The operator-facing message for a create that PROVABLY did not happen.
   *
   * Only the statuses that PROVE nothing was created reach here: a rejected name is the
   * operator's to fix, a missing connection needs HubSpot connected. A 500 is deliberately NOT
   * among them — our own BFF raises 500 for a fault at ANY position, including a parse failure
   * of a 2xx whose campaign already exists, so it is unconfirmed rather than proof. The arm that
   * used to handle it here was removed with it rather than left as unreachable code.
   */
  /**
   * Retire the possibly-created record for an event a lookup has POSITIVELY found.
   *
   * This is the record's only exit, and the design depends on it: Create stays suppressed for the
   * session precisely because an empty search proves nothing under an eventually-consistent
   * index. Finding the campaign is the one thing that DOES settle it -- so without this, the
   * suppression is permanent for the component's lifetime and the "cleared only by a positive
   * find" contract is a claim with no implementation behind it (dealako, #2079).
   *
   * Clears every set keyed on this event so the confirmed-marker and the cross-foundation
   * name fence cannot outlive the record they annotate.
   */
  private retireCreatedRecord(foundation: string, eventName: string): void {
    const key = `${foundation}|${eventName}`;
    this.hsCreatedEvents.update((seen) => {
      const next = new Set(seen);
      next.delete(key);
      return next;
    });
    this.hsCreatedConfirmed.update((seen) => {
      const next = new Set(seen);
      next.delete(key);
      return next;
    });
    // The NAME fences are global -- they answer "was a campaign with this name created under ANY
    // foundation this session?" -- so they may only be dropped once no foundation-keyed record
    // for this event survives. Deleting them alongside a single `foundation|event` record removed
    // foundation B's shared-portal warning because A resolved, and a third foundation on B's
    // portal could then see a confident not-found during indexing lag (Copilot, raised twice).
    //
    // Computed from the keyed set AFTER its own delete above, so this reads the post-retirement
    // state rather than assuming it.
    const stillHeldElsewhere = [...this.hsCreatedEvents()].some((k) => k.slice(k.indexOf('|') + 1) === eventName);
    if (stillHeldElsewhere) {
      return;
    }
    this.hsCreatedEventNames.update((seen) => {
      const next = new Set(seen);
      next.delete(eventName);
      return next;
    });
    this.hsCreatedNamesConfirmed.update((seen) => {
      const next = new Set(seen);
      next.delete(eventName);
      return next;
    });
  }

  /**
   * Repair a panel whose rendered state a just-written create record contradicts.
   *
   * The records are written BEFORE the ownership guards, deliberately -- a superseded create
   * still made a real campaign upstream. But the guards then drop the result, leaving the PANEL
   * as the earlier lookup rendered it. So a stale create settling after the replacement lookup
   * returned leaves the sets and the screen disagreeing.
   *
   * Same foundation: `hsNotFound` true and `hsCreateBlocked` true is a dead end -- a disabled
   * Create beneath "No campaign found", with no re-check offered and no exit but a reload.
   *
   * Different foundation: Create stays available, because this may be a different portal and
   * withholding there is the round-4 lockout. The panel simply never showed the shared-portal
   * warning, because it rendered before the record existed.
   *
   * Called from BOTH create arms. Only the success arm knows a campaign exists; the wording
   * asks `hsCreatedConfirmed`/`hsCreatedNamesConfirmed` rather than assuming, so a reconciled
   * panel makes no claim the record does not support.
   */
  private reconcilePanelAfterStaleCreate(): void {
    if (!this.hsNotFound()) return;
    const panelKey = `${this.activeFoundationSlug()}|${this.currentEvent()}`;
    if (this.hsCreatedEvents().has(panelKey)) {
      this.hsNotFound.set(false);
      this.hsUnconfirmed.set(true);
      this.hsStatus.set(
        this.hsCreatedConfirmed().has(panelKey)
          ? 'Created, but HubSpot has not indexed it yet — re-check to confirm. Create stays disabled so the campaign is not duplicated.'
          : 'A create for this event settled after this panel loaded and has not been confirmed — re-check before creating another.'
      );
    } else if (this.hsCreatedEventNames().has(this.currentEvent())) {
      this.hsUnconfirmed.set(true);
      this.hsStatus.set(
        this.hsCreatedNamesConfirmed().has(this.currentEvent())
          ? `No match under this project — but a campaign named for this event was created earlier in this session. If these projects share a HubSpot portal it already exists; check HubSpot before creating a second one.`
          : `No match under this project — but a create was ATTEMPTED for this event name earlier in this session and never confirmed. If these projects share a HubSpot portal one may already exist; check HubSpot before creating another.`
      );
    }
  }

  private createFailureMessage(status: number, err?: unknown): string {
    // UPSTREAM'S OWN WORDS WIN on a 400. campaign-service uses 400 for 39 distinct reasons --
    // "a campaign creation requires a non-empty name", yes, but also "invalid credentials
    // payload" and a refused event URL. Flattening all of them to "check the name and try again"
    // sends an operator to retype an input that cannot fix a credential or connection problem.
    //
    // Read from `error.error`, which is where BaseApiError.toResponse puts the operator-facing
    // text (base.error.ts:78); the hard-coded prompt below remains the fallback for a response
    // that carries none.
    if (status === 400) {
      const body = (err as { error?: { error?: string; message?: string } | string } | undefined)?.error;
      const upstream = typeof body === 'string' ? body : body?.error || body?.message;
      if (typeof upstream === 'string' && upstream.trim() !== '') {
        return upstream;
      }
    }
    if (status === 401 || status === 403) {
      // Named for what it is. Falling through to the generic line below said "HubSpot rejected
      // the campaign", which points the operator at the campaign name -- an input that cannot
      // fix a permission problem. The refusal is ours, not HubSpot's: it happens before any
      // upstream call.
      return 'You do not have permission to create campaigns on this project. Nothing was created — ask a project admin for campaign manager access.';
    }
    if (status === 404) {
      return 'No HubSpot connection is configured for this project — connect HubSpot before creating a campaign.';
    }
    return 'HubSpot rejected the campaign. Nothing was created — check the name and try again.';
  }

  private createIsCurrent(generation: number): boolean {
    return this.createGeneration === generation;
  }

  private panelStillShows(capturedEvent: string, capturedFoundation: string): boolean {
    // The FOUNDATION is part of the key, not just the event name. This component stays mounted
    // when an ED switches foundations, campaign-service selects the HubSpot connection by
    // project, and the url field does not change — so a lookup started for foundation A would
    // otherwise populate foundation B's panel, and B's brief would carry A's token.
    if (this.activeFoundationSlug() !== capturedFoundation) {
      return false;
    }
    const live = this.extractEventName(this.briefForm.controls.url.value.trim());
    // The url can be empty or half-typed mid-edit, and extractEventName then yields something
    // short that names no event. That is not evidence the user LEFT the event, so the captured
    // value is kept rather than treated as stale — matching the length gate onUrlInput applies
    // before it will issue a lookup at all.
    if (live.length <= 3) {
      return this.lastLookedUpEvent === capturedEvent;
    }
    return live === capturedEvent && this.lastLookedUpEvent === capturedEvent;
  }

  private lookupHubSpot(eventName: string): void {
    if (this.lastLookedUpEvent === eventName) return;
    this.lastLookedUpEvent = eventName;
    this.hsSearching.set(true);
    this.hsStatus.set(null);
    this.hsMatches.set([]);
    this.hsNotFound.set(false);
    this.hsCreateSuppressed.set(false);
    this.hsCompletenessUnproven.set(false);
    // The lookup is what RESOLVES the unknown, so the unconfirmed state clears when one starts.
    this.hsUnconfirmed.set(false);
    this.hsUtm.set(null);

    const capturedEvent = eventName;
    const capturedFoundation = this.activeFoundationSlug();
    const generation = ++this.lookupGeneration;
    this.campaignService
      .lookupHubSpotUtm(capturedFoundation, eventName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: HubSpotUtmLookupResult | null) => {
          // Releasing the shared in-flight flag asks "is this still the latest lookup?".
          // RENDERING asks two things, and needs both.
          if (this.lookupIsCurrent(generation)) {
            this.hsSearching.set(false);
          }
          // BOTH guards, and generation first. panelStillShows compares VALUES, so an
          // A -> B -> A foundation switch for the same event matches again and lets a stale
          // answer overwrite a newer one — and a stale not-found leaves hsNotFound true with no
          // token, which re-offers Create for a search that has already been superseded. The
          // generation counter is the only thing that tells two identical-looking lookups apart.
          // RETIRE ONLY WHEN THE ANSWER IS STILL CURRENT FOR THIS KEY. Two reviewers found the
          // two ways this goes wrong, and they pull in opposite directions:
          //
          //   - BELOW the guards, a superseded positive find is discarded, so the only evidence
          //     that clears the record is thrown away and Create stays suppressed with the answer
          //     already in hand.
          //   - ABOVE the guards unconditionally, a STALE positive find clears the record while a
          //     newer not-found is what renders. `hsNotFound` stays true, `hsCreateBlocked` goes
          //     false, and the template gates Create on `hsNotFound() && !hsUtm() &&
          //     !hsCreateSuppressed()` -- it never reads hsCreateBlocked. So Create is offered for
          //     a campaign that exists. That is the duplicate this whole record prevents.
          //
          // `panelStillShows` is the right test and the generation counter is not: the record is
          // keyed `foundation|event`, so what matters is whether the answer describes the key the
          // panel is showing, not whether this particular request is the newest. A superseded
          // lookup for the SAME key still proves the campaign exists; one for a different key
          // proves nothing about this one.
          if (result?.found && this.panelStillShows(capturedEvent, capturedFoundation)) {
            this.retireCreatedRecord(capturedFoundation, capturedEvent);
          }
          if (!this.lookupIsCurrent(generation)) return;
          if (!this.panelStillShows(capturedEvent, capturedFoundation)) return;
          // THREE states, not two. A campaign that exists but has NO utm token configured is a
          // real match — treating it as not-found would offer to CREATE a campaign that already
          // exists, into a namespace shared by every foundation and with no duplicate check
          // upstream. The legacy path never surfaced this because it fabricated a token from the
          // id and name whenever HubSpot had none.
          if (result?.found && result.hs_utm) {
            this.hsUtm.set(result.hs_utm);
            this.hsMatches.set(result.all_matches ?? []);
            this.hsStatus.set(`Found: ${result.campaign_name}`);
          } else if (result?.found) {
            // Found, but untokened. The brief gets no utm — which is honest, since HubSpot has
            // none to report against — and Create stays hidden so nobody duplicates it.
            this.hsMatches.set(result.all_matches ?? []);
            this.hsStatus.set(`Found: ${result.campaign_name} — no UTM token set in HubSpot`);
            // Re-check stays available. The lookup cleared hsUnconfirmed when it started, and
            // this is exactly the state where another read is worth taking: after a create
            // returns without hs_utm, the first re-check can legitimately FIND the campaign
            // before HubSpot has assigned its token. Leaving the flag down removed the only
            // control that settles it, stranding the operator until a reload.
            this.hsUnconfirmed.set(true);
          } else if (this.hsCreatedEvents().has(`${capturedFoundation}|${eventName}`)) {
            // A create already succeeded -- or may have -- for this event under this foundation,
            // and the lookup still cannot see it. HubSpot has not indexed it yet.
            //
            // Reported as UNCONFIRMED, and it STAYS unconfirmed until a lookup positively finds
            // the campaign. There is deliberately no miss threshold here any more.
            //
            // A count of empty searches was the exit for six revisions and it could never be
            // made correct, because it asks a question the client cannot answer. `inconclusive:
            // false` means the SEARCH COMPLETED, not that the record is absent: HubSpot's search
            // index is eventually consistent, so a campaign created seconds ago returns a
            // complete, empty, entirely truthful "not found". Any threshold therefore expires on
            // index lag rather than on evidence, re-enabling Create after a POST that may well
            // have landed -- a duplicate paid campaign, which is the exact outcome this record
            // exists to prevent. Tuning N trades one wrong answer for another; only positive
            // evidence settles it, and the `found` branches above already handle that.
            //
            // The operator is not stuck: re-check stays available and is the control that
            // resolves this, and an unconfirmed create that genuinely never landed is recovered
            // by creating the campaign in HubSpot directly -- a visible manual step, which is
            // the right cost next to silently duplicating spend.
            this.hsUnconfirmed.set(true);
            this.hsMatches.set(result?.all_matches ?? []);
            // Say only what this record's ORIGIN knows. A confirmed create means the campaign
            // exists and is merely unindexed; an unconfirmed one means the outcome was never
            // established, and asserting "Created" there sends the operator to look for
            // something that may never have been attempted -- the harm the error arm warns
            // about at the write site (dealako, round 6). Suppression is the same either way.
            this.hsStatus.set(
              this.hsCreatedConfirmed().has(`${capturedFoundation}|${eventName}`)
                ? 'Created, but HubSpot has not indexed it yet — re-check to confirm. Create stays disabled so the campaign is not duplicated.'
                : 'The earlier attempt did not confirm whether it created this campaign, and no match is visible yet — it may be unindexed, or may never have been created. Check HubSpot before creating another; re-check once it appears.'
            );
          } else if (this.hsCreatedEventNames().has(eventName)) {
            // Nothing found under THIS foundation, but a create for this event name succeeded
            // under another one this session -- and two foundations can share a HubSpot portal,
            // where campaign names are a single namespace.
            //
            // Reported as unconfirmed rather than not-found, WITHOUT withholding Create. A
            // different foundation may be a different portal, in which case creating is exactly
            // right; withholding there is dealako's round-4 lockout, which had no recovery at
            // all. So this buys the operator a warning, not a decision: the name may already be
            // taken on this portal, check before you create.
            //
            // The in-flight guard does not cover this. It falls to zero when the POST settles,
            // and the duplicate window is HubSpot's INDEXING lag, which starts there.
            this.hsNotFound.set(true);
            this.hsUnconfirmed.set(true);
            this.hsMatches.set(result?.all_matches ?? []);
            // Same honesty rule as the same-foundation branch: this set is written by BOTH create
            // arms, so "was created" is only true for the confirmed one. An unconfirmed entry may
            // describe a request that never left the BFF, and asserting a campaign exists on a
            // shared portal on that basis is a warning about nothing.
            this.hsStatus.set(
              this.hsCreatedNamesConfirmed().has(eventName)
                ? `No match under this project — but a campaign named for this event was created earlier in this session. If these projects share a HubSpot portal it already exists; check HubSpot before creating a second one.`
                : `No match under this project — but a create was ATTEMPTED for this event name earlier in this session and never confirmed. If these projects share a HubSpot portal one may already exist; check HubSpot before creating another.`
            );
          } else {
            this.hsNotFound.set(true);
            // Carried on the NOT-FOUND path too. An ambiguous lookup — a tie, or a match too weak
            // to apply unattended — deliberately reports found:false while still returning the
            // candidates it refused to choose between. Dropping them here left the operator with
            // nothing: no picker, and no Create either, because inconclusive hides that too.
            // The whole point of refusing to auto-apply is to let a human pick, which requires
            // the candidates to survive the refusal.
            this.hsMatches.set(result?.all_matches ?? []);
            // Set from the SAME response that reported the absence, so the two can never
            // disagree about which search they describe.
            // NAMED for what it holds, not for the field it reads. It gates the CREATE and takes
            // the union answer — any reason a match might be hidden is a reason not to offer a
            // non-idempotent write into a shared namespace — so it reads `inconclusive`, which is
            // the broader signal. Calling it hsCapped while it held `inconclusive` (and its twin
            // holding `capped`) made each signal look like the field named after the other.
            // FAILS CLOSED ON ABSENCE. `=== true` is false for a MISSING field, and a missing
            // field is exactly what a rolling update produces: the chart default spins up a full
            // new replica set alongside the old, without session affinity, so a browser served a
            // new bundle can call an OLD pod whose lookup response predates these fields
            // entirely. The old response also carries the old capped 10-row search -- so the one
            // moment the signal is absent is the moment the search behind it was least complete,
            // and `=== true` would offer Create precisely then (Copilot).
            //
            // Requires an explicit `false` from BOTH completeness fields. Anything else --
            // absent, null, a shape this bundle does not recognise -- suppresses, because a
            // response that cannot state its own completeness has not licensed a non-idempotent
            // write into a portal-wide namespace.
            this.hsCreateSuppressed.set(!(result?.inconclusive === false && result?.capped === false));
            // The COPY distinguishes them, because the two remedies differ — but neither may
            // claim TRUNCATION as fact. `capped` is set whenever completeness cannot be proven,
            // which includes HubSpot omitting `total` entirely, so "it matched more than it
            // could return" would be fabricated for a response that never said so, and would
            // send the operator to narrow a term when the remedy is to check the name.
            this.hsCompletenessUnproven.set(result?.capped === true);
            this.hsStatus.set(this.noMatchStatus(result?.capped === true, result?.inconclusive === true));
          }
        },
        error: () => {
          // hsSearching is shared across lookups, unlike the create's hsCreating: clearing it
          // unconditionally lets an OLDER request's failure declare a newer in-flight lookup
          // finished. So it is released only by the lookup that still OWNS it — a narrower
          // question than whether its answer may be rendered, below.
          if (this.lookupIsCurrent(generation)) {
            this.hsSearching.set(false);
          }
          // Same pair of guards as the success arm, for the same reason. A superseded lookup's
          // FAILURE is not evidence about the current one: after an A -> B -> A round trip
          // panelStillShows matches again, so a stale error would overwrite hsStatus and set
          // hsUnconfirmed on a newer search — and nothing on the success path clears
          // hsUnconfirmed, so the panel stays stuck on a failure that did not happen to it.
          if (!this.lookupIsCurrent(generation)) return;
          if (!this.panelStillShows(capturedEvent, capturedFoundation)) return;
          this.hsStatus.set('HubSpot lookup failed');
          // The control is restored, not left cleared. A lookup that FAILED established
          // nothing, and this arm leaves lastLookedUpEvent set — so without it the same event
          // shows neither Create nor a re-check, and the only exit is a page reload. Retrying
          // the lookup is exactly the right action after a failed lookup.
          this.hsUnconfirmed.set(true);
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
