// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { MetricPercentPipe } from '@app/shared/pipes/format-metric.pipe';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  CAMPAIGN_DELIVERY_TYPES,
  CAMPAIGN_EMAIL_TYPES,
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  CAMPAIGN_PROGRAM_TYPES,
  CAMPAIGN_TABS,
  DEFAULT_CAMPAIGN_EMAIL_TYPE_ID,
  EMAIL_BRIEF_REQUIRED_HINT,
  EVENT_TEMPLATE_SUGGESTION_MIN_SCORE,
  EVENT_TERM_DISTINCTIVE_LENGTH,
  EVENT_TERM_STOPWORDS,
  EVENT_TERM_YEAR_PATTERN,
  EVENT_TERM_WEIGHT,
  HUBSPOT_TEMPLATE_RENDER_LIMIT,
  MARKETING_OPS_FGA_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import type {
  BriefMetrics,
  BriefMetricsRow,
  CampaignBriefOutput,
  CampaignAudience,
  CampaignServiceEmailMetrics,
  CampaignJobOutcome,
  CampaignEmailStage,
  EmailBriefCopy,
  EventTemplateTerms,
  CampaignCreateRequest,
  CampaignBriefPersistenceState,
  CampaignImplementationDraft,
  CampaignBriefPersistResult,
  CampaignDeliveryType,
  CampaignIndexDoc,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
  HubSpotMarketingEmail,
} from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { CampaignService } from '@services/campaign.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { firstValueFrom, skip, Subscription, take } from 'rxjs';

import { HubSpotTemplateLabelPipe } from '../../../shared/pipes/hubspot-template-label.pipe';
import { HubSpotUpdatedAtPipe } from '../../../shared/pipes/hubspot-updated-at.pipe';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [
    DecimalPipe,
    MetricPercentPipe,
    ReactiveFormsModule,
    ButtonComponent,
    SelectComponent,
    PlanningTabComponent,
    ImplementationTabComponent,
    MonitoringTabComponent,
    OptimizationTabComponent,
    HubSpotUpdatedAtPipe,
    HubSpotTemplateLabelPipe,
  ],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly destroyRef = inject(DestroyRef);
  /** Dual-gated with `ServerFeatureFlag.MarketingOpsFga` — see LFXV2-2235/LFXV2-2236. */
  private readonly marketingOpsFgaEnabled = this.featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false);

  protected readonly tabs = CAMPAIGN_TABS;
  protected readonly programTypes = CAMPAIGN_PROGRAM_TYPES;
  protected readonly deliveryTypes = CAMPAIGN_DELIVERY_TYPES;
  // lfx-select's `options` input is typed as a mutable `any[]`, so pass a shallow
  // mutable copy of the readonly constants rather than the `readonly` arrays directly.
  protected readonly programTypeOptions = [...CAMPAIGN_PROGRAM_TYPES];
  protected readonly deliveryTypeOptions = [...CAMPAIGN_DELIVERY_TYPES];

  // The two selectors are reactive-form controls so they can bind to the lfx-select
  // wrapper (form-driven). nonNullable keeps the value typed to the union, never `| null`.
  protected readonly selectorForm = new FormGroup({
    programType: new FormControl<CampaignProgramType>('events', { nonNullable: true }),
    deliveryType: new FormControl<CampaignDeliveryType>('paid-marketing', { nonNullable: true }),
  });

  /**
   * No brief in flight, and nothing to say about one.
   *
   * Shared by the pre-handoff state and the flag-off response on purpose: both mean "render no
   * persistence UI at all". A disabled cutover is an ordinary deployment state — the chart
   * enables it since #1881, but any override or un-rolled pod still reports off — so it must look
   * exactly like the ordinary case rather than like a degraded one.
   *
   * Declared before briefPersistence because a class field cannot read one declared after it.
   */
  private readonly idlePersistence: CampaignBriefPersistenceState = { status: 'off', briefId: null, message: null, approved: false };

  /** The Paid Marketing side's current tab. Email keeps its own — see the delivery-type effect. */
  protected readonly selectedTab = signal<CampaignTab>('planning');

  /**
   * The Email side's current tab.
   *
   * Typed to exclude 'optimization' rather than merely documenting that it is never set: the
   * exclusion is the whole reason this signal exists separately, so the compiler should be the
   * thing that enforces it. `selectTab` narrows before assigning.
   */
  protected readonly selectedEmailTab = signal<Exclude<CampaignTab, 'optimization'>>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly selectedDeliveryType = signal<CampaignDeliveryType>('paid-marketing');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);
  protected readonly briefPersistence = signal<CampaignBriefPersistenceState>(this.idlePersistence);

  /**
   * Is a brief save in flight, independent of whether a banner is shown for it?
   *
   * These were the same thing, and that conflation was a bug. `briefPersistence` drives the
   * BANNER, and the first save of a session deliberately shows none — the persistence flag lives
   * on the server, so until the first response arrives we cannot know whether the cutover is even
   * on, and a "Saving this brief…" banner would otherwise appear for every user in every
   * environment where it is dark (all of them, by default). So the first save sits in `off`.
   *
   * `off` therefore meant two different things: "the cutover is dark" and "the first save is
   * running and we do not yet know". The Implementation tab needs to tell them apart, because a
   * create issued during that window carries an empty brief id and is TERMINALLY refused with the
   * cutover on. This signal is the half that answers "is a save running", with no bearing on what
   * is displayed.
   */
  protected readonly briefSaveInFlight = signal(false);

  /**
   * How many saves are enqueued or running. Backs `briefSaveInFlight`.
   *
   * Saves are serialised on `persistChain`, so more than one can be outstanding: each appends its
   * own clear, and with two queued the first one's clear lands between A finishing and B starting.
   * Counting is what keeps the signal true across that seam.
   */
  private pendingBriefSaves = 0;

  /**
   * The Implementation tab's in-progress edits, held here so a tab switch cannot discard them
   * (LFXV2-3229).
   *
   * `ImplementationTabComponent` stays inside the lazy `@switch` — it resolves the LinkedIn ad-account list in
   * `ngOnInit`, so mounting it eagerly the way LFXV2-3202 (PR #1437, pending) proposes mounting the planner would issue that
   * request on every page load for a tab many users never open. Holding its edits up here is the
   * cheaper half of that trade: the component is still destroyed, but the user's typing is not.
   *
   * NOT keyed by `(project, event)` like `knownBriefIds`, and the asymmetry is deliberate. A brief
   * id names a row that outlives the page, so replaying the wrong one corrupts durable state. A
   * draft is scratch: the worst a stale one can do is show the wrong copy, and the child already
   * refuses to apply a draft whose `eventSlug` does not match the brief on screen. A key here
   * would be machinery guarding against a hazard that is already closed one level down.
   */
  protected readonly implementationDraft = signal<CampaignImplementationDraft | null>(null);

  /**
   * What each conflict means to the user. A map rather than nested ternaries, which the lint
   * rules forbid — and which would read badly here anyway, since the three cases are unrelated
   * situations rather than degrees of one.
   *
   * `superseded-after-write` is the odd one: its write DID land, so its message must not say
   * "not saved". Confirming it as saved would be worse still — the row may no longer hold this
   * content at all, and "Brief saved." is the one thing this banner must never say falsely.
   */
  private readonly conflictMessages: Record<NonNullable<CampaignBriefPersistResult['conflict']>, string> = {
    // "Reload" alone is not enough and the saved banner already says so: the Planning url control
    // initializes empty and `loadBrief` runs only once a url is entered, so a reloaded page shows
    // nothing until the user pastes the event url again. Advice that stops at "reload" leaves
    // them on a blank Planning tab wondering where the brief went.
    'unowned-brief-exists':
      'This event already has a saved brief that was not opened here, so this one was not saved over it. Reload and re-enter the event URL to work from the stored brief.',
    // Does NOT advise a reload, even though this branch adds the read path that would make one
    // work. Here it would be actively destructive: a stale-brief refusal PROMOTES this session to
    // explicit overwrite permission (see the conflict handler), so the very next Proceed saves
    // the work currently on screen. Telling the user to reload throws that work away to reach a
    // state they can already get to by clicking Proceed again.
    //
    // An earlier revision said "Reload and re-enter the event URL to see their changes" — added
    // while restoring reload advice this branch had dropped, without noticing it contradicts the
    // promotion added on the base. `unowned-brief-exists` above is the conflict that genuinely
    // needs reload advice: there the session may NOT replace, so the stored brief has to be
    // loaded before anything can proceed.
    'stale-brief':
      'Someone else changed this brief while you were working, so this version was not saved over theirs. Proceed again to save your version over theirs.',
    // Names the consequence, like the other two. It did not need to while this conflict granted
    // no permission — but it now promotes the session to overwrite, and a message that reports
    // only "someone else changed it" leaves the user authorising a replacement they were never
    // told about. That is the disclosure gap the other two messages were rewritten to close.
    'superseded-after-write':
      'Your brief was saved, but someone else changed it moments later, so what is stored may not be your version. Proceed again to replace theirs with yours.',
    // Says "try again" rather than naming another writer, because none is known to exist: the
    // problem is that this page cannot prove which version it last saw, not that someone else
    // changed it.
    //
    // But it must also SAY what trying again does. This warning promotes the session to explicit
    // overwrite permission, so the next Proceed replaces whatever is stored — including a version
    // this page has never seen. An earlier revision said only "Try again to save it", which hid
    // that: the user authorised an overwrite by clicking a button whose label implied a retry.
    // The `stale-brief` message already names the consequence; this one now does too.
    'unverified-validator':
      'This brief could not be saved safely because its last saved version is unconfirmed. Proceed again to replace whatever is currently saved.',
  };

  /**
   * The campaign-service brief id this session has established ownership of, or null.
   *
   * TWO sources on this branch, and both are genuine proof: the page LOADED the brief from
   * campaign-service (the restore path), or it CREATED the brief itself on an earlier save.
   * Recording the created id is what stops the second Proceed of a session being refused as
   * unowned — a user editing and re-proceeding would otherwise be told their own brief belongs
   * to someone else.
   *
   * Sent with the next save as proof: the server refuses to replace a stored brief for a caller
   * that cannot name it, because a reload or a second tab is enough to reach a save that would
   * otherwise overwrite content the user never saw (LFXV2-3200).
   *
   * NOT cleared by `resetToPlanning`, and that is the point of keying it. An earlier revision did
   * clear it, on the reasoning that a stale id would let the next brief claim the previous one's
   * row — but the key already prevents that: an id filed under `(foundation, event A)` can never
   * be replayed for event B. Clearing it instead STRANDED the row, because discarding the
   * on-screen brief does not delete the stored one, and the next save of that same event then
   * arrived with no id and was refused as unowned.
   *
   * Keyed BY foundation slug, because a single scalar is wrong across a foundation switch twice
   * over. That switch does not re-create this component and deliberately keeps the brief (see the
   * constructor), so with one slot: saving under TLF then under CNCF overwrites TLF's id, and
   * switching back to TLF replays CNCF's id against TLF's row — an update the user does own,
   * refused. Merely tagging the slot with its slug fixes the wrong id but not the loss: returning
   * to TLF would then create a second row instead of replacing the one this session made.
   *
   * Keyed by BOTH halves of the server's own identity for a brief, `(project_id, event_slug)`, so
   * an id can only ever be replayed against the row it names. That makes the invariant structural
   * rather than something each future code path has to remember, and it applies to both sources
   * above: a restored id is as event- and foundation-specific as a created one.
   *
   * An earlier revision keyed only the foundation and claimed the event half was covered because
   * "every event change goes through `resetToPlanning`". That premise is false — `selectTab` sets
   * the tab directly, so returning to Planning by clicking the tab recreates the planning form
   * without any reset. Restore event A, click Planning, generate a brief for event B: with a
   * foundation-only key, B's save would carry A's id and the server would accept an overwrite of
   * a brief this session never loaded, which is precisely what the guard exists to prevent.
   *
   * The event half is derived exactly as the write path derives the key it sends
   * (`deriveEventSlug` in `campaign-service.service.ts`): `eventDetails.slug` EXACTLY as
   * stored, with trimming used only to test emptiness — that helper returns the untrimmed
   * original, and that exact string is what goes on the wire as `event_slug`.
   *
   * It is duplicated rather than imported because that module is SERVER-side and this component
   * runs in the browser; deriving it any other way would let the lookup and the request disagree
   * about which row is being claimed, so the two must be changed together.
   *
   * A plain field rather than a signal: nothing renders it, and it answers "may this save
   * replace?" at the moment a request is built.
   *
   * ### Why `absence` encodes a REASON rather than just a missing validator
   * `etag: null` alone cannot say WHY there is no validator, and the two reasons need opposite
   * treatment on the next save:
   *
   * - `'overwrite'` — permission is real, so falling back to the freshly read validator is what
   *   the user asked for. TWO paths set it, and both are explicit decisions taken on content the
   *   user was actually shown:
   *     1. The stale-brief warning was displayed and they proceeded anyway.
   *     2. A restore whose read returned NO validator. They were shown the stored brief and chose
   *        to work from it; there is simply no ETag to carry. Classifying that as `'unknown'`
   *        would refuse the first save after any such restore — the feature's main path, and not
   *        a conflict anyone can act on.
   *   What separates both from `'unknown'` is that something was displayed and something was
   *   chosen, NOT that a warning specifically appeared.
   * - `'unknown'` — the write returned no ETag, or its approval outcome was indeterminate. Nobody
   *   was warned and nothing was decided; falling back here would bypass the precondition
   *   silently and could overwrite an intervening writer without ever showing a conflict.
   *
   * Encoding the reason rather than the absence keeps them apart. A save with an `'unknown'`
   * validator sends none, and the server's ownership check still decides whether it may replace.
   */
  private knownBriefIds = new Map<string, { id: string; etag: string | null; absence?: 'overwrite' | 'unknown' }>();

  /**
   * True while `onRestoreSavedBrief` is adopting a restored brief's own program.
   *
   * The `programType` subscription treats a change as the user choosing a different program and
   * calls `resetToPlanning`, which discards the brief on screen. That is right for a user
   * switching programs and wrong for this: the program is not changing away from the brief, it is
   * catching up TO it.
   *
   * (`resetToPlanning` no longer clears `knownBriefIds` — the row still exists upstream, so its
   * id stays valid. Only the on-screen brief is discarded.)
   *
   * An earlier revision relied on statement order alone — the adopt runs before the ownership
   * write and before `onProceedToImplementation`, so a reset triggered here is undone by both.
   * That works, and it is why NO TEST FAILS when this flag is ignored: the ordering rescues it.
   *
   * The flag is kept anyway, as defence rather than behaviour. Moving the adopt below either of
   * those statements — a reasonable-looking edit — would silently strand the restored brief, and
   * the previous comment asserting "the subscription sees no change" was simply false. This makes
   * the intent explicit at the point that decides it instead of leaving it implicit in line
   * order.
   */
  private adoptingRestoredProgram = false;

  /**
   * Per `(project, event)` key, bumped whenever a RESTORE writes ownership for that key, so a
   * save already queued for the SAME key cannot inherit it.
   *
   * Distinct from `ownershipGeneration`, which marks a DISCARD. This marks an ARRIVAL from a
   * source the queued save never saw: the user loaded a stored brief for the same event while a
   * generated one was waiting to send. Sharing a counter would conflate "the thing you owned is
   * gone" with "someone else's id landed under your key".
   *
   * Keyed rather than a single session counter, and that distinction is load-bearing. Ownership
   * is keyed by `(project, event)`, so a session-wide counter would let a restore of event A
   * invalidate a queued save of event B — discarding the id B's own predecessor save created and
   * turning a correct save into an `unowned-brief-exists` refusal, which is the exact failure
   * the late lookup exists to prevent. An epoch has to be scoped to whatever it guards.
   */
  private ownershipEpochs = new Map<string, number>();

  /**
   * Which brief `briefPersistence` currently describes.
   *
   * A save is not awaited and not cancelled (see `persistBrief`), so its response can land after
   * the user has already moved on — a program switch or a second Proceed both run
   * `resetToPlanning`. Without this counter the late response writes `saved` and a `briefId`
   * for a brief the page no longer holds, which is worse than a stale spinner: the id shown
   * belongs to a different brief, and `saved` claims durability for the one on screen, which
   * was never sent anywhere.
   *
   * Incremented by every event that changes which brief is current, and compared inside the
   * subscription. A mismatch means the result is for a superseded brief and is dropped — the
   * newer owner of the signal has already set the state it wants.
   */
  /** The in-flight staging poll, so a second Stage cannot leave two pollers racing. */
  private stagingJobSubscription: Subscription | null = null;

  /**
   * Guards a late copy response against a stage the operator has since changed.
   *
   * `onSelectEmailType` clears `emailCopy` while a generate request may still be in flight, and
   * the selector stays usable — so the older response resolves afterwards and repopulates the
   * panel with the PREVIOUS stage's copy under the new stage's label. Clearing the signal cannot
   * prevent that; only a counter can tell the two responses apart.
   */
  private emailCopyGeneration = 0;

  /**
   * Guards a late audience response against a brief the page no longer holds.
   *
   * Same hazard as `emailCopyGeneration`, and the reset alone cannot close it: clearing
   * `emailAudience` does nothing to a build already in flight, whose response then reports a
   * BUILT audience belonging to the previous brief -- and `canStageEmail` gates on exactly that
   * status, so the stale success re-enables staging against the wrong brief.
   */
  private emailAudienceGeneration = 0;

  /**
   * Guards the staging path against a brief the page no longer holds.
   *
   * Staging AWAITS `ensureEmailBriefId` and then CREATES a campaign. A reset landing in between
   * meant the create proceeded against the previous brief -- and unlike a stale read this one
   * WRITES: it clones a HubSpot draft and points it at that brief's audience. The reset bumps
   * this, so the create is abandoned rather than issued against a context nobody is looking at.
   */
  private emailStagingGeneration = 0;

  /**
   * The persist a concurrent caller can join instead of starting a second one.
   *
   * `ensureEmailBriefId` caches the id only AFTER its persist resolves, so two email actions
   * started close together -- generate copy and build audience, say -- each saw an empty cache
   * and each issued a first-save persist for the same (project, event). Whichever landed second
   * either created a duplicate brief or lost the ownership race. Sharing the in-flight promise
   * makes the second caller await the first rather than race it.
   */
  private emailBriefPersistInFlight: Promise<string> | null = null;

  private briefPersistenceGeneration = 0;

  /**
   * Bumped only when the page DISCARDS what it owns, which today means `resetToPlanning` alone.
   *
   * NOT a foundation switch: that handler clears the banner but deliberately keeps the map, whose
   * keys already name the foundation each id belongs to.
   *
   * Separate from `briefPersistenceGeneration`, which a queued sibling save also bumps. That
   * conflation is what made ownership impossible to place: checking the display counter after a
   * response, a save superseded by ANOTHER SAVE OF THE SAME EVENT looked identical to one
   * superseded by a reset, so recording behind that check lost the row a queued predecessor had
   * created and the next save of that event was refused as unowned. Not checking at all let a
   * late response re-file an id after a reset had cleared it.
   *
   * A response may record ownership when nothing has been discarded since it left, which is
   * exactly this counter and not the other one.
   */
  private ownershipGeneration = 0;

  /**
   * The tail of this session's save queue — see `persistBrief` for why saves are serialised.
   *
   * A plain promise rather than an RxJS operator because the queue must OUTLIVE the component:
   * `concatMap` under `takeUntilDestroyed` would abort a save in flight when the user navigates
   * away, which is exactly the behaviour `persistBrief` documents it must not have.
   */
  private persistChain: Promise<void> = Promise.resolve();

  /**
   * The foundation the current `briefPersistence` was filed under.
   *
   * A foundation switch does NOT re-create this component. The sidebar navigates only on a lens
   * change or off an entity page (`sidebar.component.ts` `redirectOnContextSwitch`), and
   * `/foundation/campaigns` is neither — it is a two-segment route in the foundation lens, so
   * picking another foundation runs `setFoundation`, which moves the `?project=` param with
   * `Location.replaceState` and nothing else. The page stays mounted and `activeContext()`
   * changes underneath it.
   *
   * That makes the slug part of what identifies the brief being described, exactly like the
   * generation counter: a `saved` banner naming a brief in one foundation's table must not be
   * left sitting under another one, whether the response landed before the switch or after it.
   */
  protected readonly activeFoundationSlug = computed(() => this.projectContextService.activeContext()?.slug ?? '');

  /**
   * Reactive re-check of the grant that put this page on screen, mirroring
   * `marketing-impact.component.ts`'s `hasFullMarketingAccess`.
   *
   * `campaignAccessGuard` only runs once, on navigation — it never re-fires for the
   * `Location.replaceState` foundation switch `activeFoundationSlug` documents. Without this,
   * a campaign_manager grant scoped to foundation A stays rendering foundation A's campaigns
   * (as far as this page can tell) after switching to foundation B, where the operator may hold
   * no grant at all. Reading `isCampaignManager()` here re-evaluates against whatever
   * `sidebar-nav.service.ts` last resolved for the active foundation, so the template gate
   * tracks the switch instead of trusting the one-time guard result forever.
   *
   * Mirrors `campaign-access.guard.ts`'s SSR fast path (LFXV2-2236): the flag client never
   * initializes server-side, so `marketingOpsFgaEnabled()` defaults `false` there regardless of
   * the operator's real grant. Denying before the browser has a chance to resolve the flag would
   * render `campaigns-no-access` for a legitimate FGA campaign manager on first paint, then flip
   * to granted post-hydration — the guard already accepted that same window (it defers instead of
   * denying), so mirroring it here avoids a hydration-mismatching flash the guard's own deferral
   * doesn't otherwise prevent at the component level.
   */
  protected readonly hasCampaignAccess = computed(() => {
    if (this.personaService.currentPersona() === 'executive-director') {
      return true;
    }
    if (!isPlatformBrowser(this.platformId) || !this.featureFlagService.providerReady()) {
      return true;
    }
    if (!this.marketingOpsFgaEnabled()) {
      return false;
    }
    const slug = this.activeFoundationSlug();
    // Read from the per-scope grant map: each scope's result is stored independently, so a newer
    // cross-scope probe (e.g. sidebar-nav for a different foundation) cannot overwrite this
    // foundation's confirmed answer — that probe writes into its own key, not this one
    // (Copilot finding, PR #1835: confirmActiveGrant force-write overwritten by later probe).
    // Check this foundation's entry first, then fall back to a confirmed ROOT grant (null key).
    const grants = this.personaService.grantsByScope();
    const scopedGrant = slug ? grants.get(slug) : undefined;
    if (scopedGrant?.isCampaignManager) return true;
    const rootGrant = grants.get(null);
    if (rootGrant?.isCampaignManager) return true;
    // An authoritative `false` at either scope key must win over the legacy global signal below,
    // which can be stale `true` from a different scope's earlier probe (Copilot/Cursor finding,
    // PR #1835: legacy fallback overrides an authoritative map denial).
    if (scopedGrant !== undefined || rootGrant !== undefined) {
      return false;
    }
    // No per-scope entry yet (before the guard's first probe for this scope has returned) —
    // fall back to the global signal with the slug gate for the brief pre-resolve window.
    const grantSlug = this.personaService.marketingGrantSlug();
    if (slug && grantSlug !== null && grantSlug !== slug) {
      return false;
    }
    return this.personaService.isCampaignManager();
  });

  /**
   * The campaigns this brief created, as the platform's index currently reports them.
   *
   * Loaded rather than derived, because the create job's per-platform results only exist in the
   * session that ran it — a reload leaves the page with no handle on the campaigns it just made.
   * This is what gives the Optimize tab something to name (LFXV2-3099).
   *
   * `null` means NOT LOADED, which is deliberately distinct from an empty array. The Optimize tab
   * renders nothing at all for `null` and an explicit empty state for `[]`, because "we have not
   * asked yet" and "the brief has no campaigns" want opposite treatment on screen.
   */
  protected readonly briefCampaigns = signal<CampaignIndexDoc[] | null>(null);

  /**
   * Whether an empty `briefCampaigns` may simply not be indexed yet.
   *
   * Passed down rather than dropped: indexing is asynchronous, so an empty list moments after a
   * create means "not visible yet", not "nothing was created". Rendering a bare "no campaigns"
   * over that window would tell someone their spend does not exist.
   */
  protected readonly briefCampaignsStale = signal(false);

  /**
   * Whether the last campaign-list read FAILED, as opposed to never having run.
   *
   * `briefCampaigns` is `null` in both cases, and without this flag those two are the same pixel:
   * an empty panel. That is the failure-as-absence shape — a Query Service outage rendered as
   * "nothing here" over campaigns that may be live and spending, with nothing for the operator to
   * act on. Carried as a separate flag rather than folded into the list, because `null` already
   * carries a meaning ("not loaded") and overloading it would make absence signal a second thing.
   */
  protected readonly briefCampaignsUnavailable = signal(false);

  /**
   * Whether this DEPLOYMENT can service a pause/resume, as reported by the server with the list.
   *
   * Defaults to `false` — the safe direction. The list read is ungated while the toggle route is
   * flag-gated, so assuming "enabled" until told otherwise is what renders buttons that can only
   * fail; assuming "disabled" until the server confirms merely withholds a control for one
   * request. Reset on a foundation switch alongside the rows it describes, because it is a fact
   * about the response those rows came from.
   */
  protected readonly briefCampaignsToggleEnabled = signal(false);
  /**
   * Whether this deployment can create a Demand Gen Google campaign — `null` while unknown.
   *
   * Unlike `briefCampaignsToggleEnabled` above this is NOT reset to `false` on the error and
   * pre-request arms, and the asymmetry is deliberate. That flag guards a control the user has
   * not touched, so a false negative merely withholds a button. This one is read by the
   * Implementation tab's draft restore, where a false negative REWRITES the user's saved
   * selection — so the arms that mean "no answer" must say `null`, not "off".
   *
   * Two readers write it: `loadBriefCampaigns` on Optimize entry, and `loadCreateCapabilities`
   * on the Implementation entry paths — the create path needs the answer BEFORE any campaign
   * exists, so it cannot wait for the first. `null` therefore means "unanswered or failed", not
   * "never asked". The tab treats it as "withhold the control but preserve the draft", which is
   * the correct behaviour for an unanswered question;
   * the server-side predicate reports `true` whenever the legacy creator still owns creation, so
   * the common case is not a silently missing control.
   */
  protected readonly briefCampaignsDemandGenEnabled = signal<boolean | null>(null);

  /**
   * Generation counter for the campaign-list read — the same mechanism as `emailSearchGeneration`,
   * reused rather than reinvented.
   *
   * A foundation switch does not re-create this component (see `activeFoundationSlug`), so a list
   * request dispatched for foundation A resolves after the user has moved to B and would write A's
   * campaigns into B's panel. Clearing the signals on switch cannot stop that on its own: the
   * response lands afterwards and overwrites the cleared state. Bumping this is what makes the
   * clears stick — a response whose generation no longer matches writes nothing.
   */
  private briefCampaignsGeneration = 0;

  /**
   * Guards a late email-metrics response against a context that has since changed.
   *
   * Same hazard and same remedy as `briefCampaignsGeneration`: a read dispatched for one
   * (foundation, brief) can resolve AFTER a switch, and its `next` would write the previous
   * foundation's sends into a panel now labelled with the new one. Clearing the signals is not
   * enough on its own — the clear happens first and the stale write lands after it.
   */
  private emailMetricsGeneration = 0;

  /**
   * Generation counter for the create-time capability read — its OWN, deliberately.
   *
   * Two wrong versions preceded this one, and both were reachable. Sharing
   * `briefCampaignsGeneration` fails because `loadBriefCampaigns` increments it, so an ordinary
   * Optimize visit discarded an in-flight capability response. Guarding on the foundation alone
   * fails the other way: it drops no valid response but imposes no ORDER, so two Implementation
   * entries within one foundation can land out of order and an older failure can wipe a newer
   * success back to `null`.
   *
   * Ordered by ANSWER, not by dispatch, and shared by every writer of the capability.
   *
   * Dispatch order is the obvious rule and it is wrong here, because the two readers race in both
   * directions. `loadCreateCapabilitiesFor` can answer while an Optimize list is still open, and
   * `loadBriefCampaigns` can answer while a capability read is still open — "last dispatched
   * wins" drops a good answer in whichever direction happens to lose, which is how the first two
   * versions of this guard each broke one case while fixing the other.
   *
   * What both cases actually want is the same invariant: a SUCCESS is authoritative from the
   * moment it lands, and nothing older may overwrite it — least of all a failure, which has
   * established nothing. So this is stamped when an answer is WRITTEN, and a writer defers to it
   * if another answer has landed since it dispatched.
   *
   * It does NOT cover a foundation switch: that clears the capability but dispatches nothing, so
   * it never bumps this. The two readers reject the previous foundation's response by different
   * means, and both are load-bearing: `loadCreateCapabilitiesFor` compares the slug it dispatched
   * against the active one, while `loadBriefCampaigns` relies on the switch handler incrementing
   * `briefCampaignsGeneration`, which its own `isCurrent` checks. Stated apart from the ordering
   * above so neither is removed on the strength of the other.
   */
  private capabilityGeneration = 0;

  /**
   * Whether the server has told us the brief-persistence cutover is on.
   *
   * Starts false meaning UNKNOWN, not off, and only a response can change it: the flag is an
   * environment variable read inside the Express handler, and this application has no channel
   * that would let the browser learn a server flag before making a request. `persistBrief`
   * therefore withholds the in-flight banner until the first response, so a dark cutover renders
   * nothing rather than a spinner. Deliberately NOT reset by `resetToPlanning` — the flag belongs
   * to the deployment, not to the brief being edited, and re-hiding the banner for every
   * subsequent save would reintroduce the flicker one brief at a time.
   */
  private readonly briefPersistenceEnabled = signal(false);

  /**
   * The Email side's approved brief. Separate from `briefOutput` for the same reason the tab
   * signals are separate: both containers stay mounted, so one shared signal would let a brief
   * approved under Paid Marketing appear in Email's Implement tab after a round-trip.
   */
  protected readonly emailBriefOutput = signal<CampaignBriefOutput | null>(null);

  /**
   * The HubSpot marketing emails a user can clone as the template for this send.
   *
   * `null` means NOT SEARCHED, which is distinct from `[]` (searched, portal returned nothing)
   * for the same reason it is on the campaign list: an empty array asserts the portal has no
   * matching templates, and only a completed search can support that claim. A failed search must
   * not be rendered as an empty portal.
   */
  protected readonly emailTemplates = signal<HubSpotMarketingEmail[] | null>(null);
  protected readonly emailTemplateQuery = signal('');
  /**
   * The query the CURRENT results were fetched for, as opposed to `emailTemplateQuery`, which is
   * the draft in the input and changes on every keystroke.
   *
   * The empty state names a query, and naming the draft made it a claim about a search that never
   * ran: typing "beta" after an "alpha" search relabelled alpha's results as
   * `No templates match "beta"` before any beta request existed.
   */
  protected readonly emailTemplateSubmittedQuery = signal('');

  /**
   * What a screen reader announces about the template search.
   *
   * A computed feeding a PERSISTENT region, matching the pattern in implementation-tab: an
   * aria-live element inserted with its text already present is not reliably announced, so
   * the region must exist first and then have its CONTENTS change. Search progress and
   * results were previously silent — the picker rendered them visually only.
   */
  protected readonly emailTemplatesAnnouncement = computed<string>(() => {
    if (this.emailTemplatesLoading()) return 'Searching templates';
    // The error case is deliberately ABSENT, matching briefPersistenceAnnouncement: the visible
    // error node already carries role="alert", so returning the same string here would announce
    // the failure twice.
    if (this.emailTemplatesError()) return '';
    // The SAME computed the visible node renders, not a second copy of the sentence: the two
    // drifted once already, and an announcement that names no project while the text on screen
    // names one describes a different failure to a screen-reader user than to a sighted one.
    if (this.emailChannelEnabled() === false) return this.emailNotConnectedMessage();
    const templates = this.emailTemplates();
    if (templates === null) return '';
    if (templates.length === 0) {
      const q = this.emailTemplateSubmittedQuery();
      // Quoted to match the visible copy character-for-character. Without the delimiters the
      // query dissolves into the sentence it sits in: a search for "no templates" announced as
      // "No templates match no templates." Sighted users get the boundary from the quote marks;
      // this is the only place the two texts said different things.
      return q ? `No templates match “${q}”.` : 'This portal has no marketing emails yet.';
    }
    const count = `${templates.length} template${templates.length === 1 ? '' : 's'} found.`;
    // The truncation cue must carry over, for the same reason the sibling appends its reload
    // instruction: announcing the count alone gives the reassurance without the instruction, and
    // the instruction is the part a screen-reader user cannot recover on their own — nothing else
    // says the list may be partial.
    //
    // "MAY be", not "is": `possiblyTruncated` records when the 500 cap MIGHT have bitten, and a
    // portal holding exactly 500 emails sets the same flag on a complete listing — the shared
    // interface says a capped 500 is byte-identical to a complete one. Asserting a partial list
    // as fact would send someone hunting for a template that does not exist.
    // The render cap must carry over for the same reason the truncation cue does: a
    // screen-reader user hears "4000 templates found" and then reaches the 100th button with no
    // way to discover that the rest were never drawn. Stated as fact — unlike the truncation
    // hedge below, both numbers here are known exactly.
    const capped = this.emailTemplatesRenderCapped() ? ` ${this.emailTemplatesRenderCapMessage()}` : '';
    return this.emailTemplatesTruncated() ? `${count}${capped} This may be a partial list. Search to narrow it.` : `${count}${capped}`;
  });
  protected readonly emailTemplatesLoading = signal(false);
  /**
   * Monotonic id for the in-flight template search.
   *
   * Not a signal: nothing renders it, and it must be readable synchronously inside a subscribe
   * callback to decide whether that response is still the current one. A plain counter is the
   * whole mechanism — a response whose generation no longer matches writes nothing.
   */
  private emailSearchGeneration = 0;
  protected readonly emailTemplatesError = signal<string | null>(null);

  /**
   * Whether the listing may have been cut off by the service's unfiltered cap.
   *
   * Only ever true for an EMPTY query, where a complete portal listing and a truncated first
   * screen are indistinguishable on the wire. A filtered search is complete-or-error, so this
   * stays false there — telling someone to narrow a search that was already exhaustive would
   * send them looking for a template that does not exist.
   */
  protected readonly emailTemplatesTruncated = signal(false);

  /**
   * The template auto-derived from HubSpot for this event, if one was confident enough to offer.
   *
   * A SUGGESTION the operator can change, never a decision. Empty means no template scored above
   * `EVENT_TEMPLATE_SUGGESTION_MIN_SCORE` and the picker behaves exactly as it did before -- which
   * is the honest outcome for a portal whose templates do not name their event. Withholding a weak
   * guess matters more than offering one: a pre-selection looks decided, so nobody re-reads it,
   * and cloning the wrong template puts another event's branding into a real HubSpot draft.
   */
  protected readonly emailTemplateSuggestionId = signal<string>('');

  /** Which event terms the suggested template matched on, so the operator can judge it themselves. */
  protected readonly emailTemplateSuggestionTerms = signal<readonly string[]>([]);

  /**
   * The matched terms as one display string.
   *
   * A `computed` rather than `.join()` in the template: the checklist allows only signal reads,
   * computed values and pipes there, and a `join` in an interpolation re-runs on every
   * change-detection pass over an array that changes only when a search answers.
   */
  protected readonly emailTemplateSuggestionTermsLabel = computed<string>(() => this.emailTemplateSuggestionTerms().join(', '));

  /**
   * Screen-reader announcement for the auto-selection.
   *
   * The banner is a plain `<p>` inserted when the suggestion lands, and a newly inserted element
   * is not reliably announced -- so a screen-reader user could miss that a template was chosen for
   * them, and that it is the one staging will use. Routed through the picker's existing live
   * region, which is already mounted and only has its CONTENTS change.
   */
  /**
   * The live region's whole text, joined with a separating space.
   *
   * Concatenating the two computeds directly in the template ran them together --
   * "…37 found.Template selected for this event: …" -- which a screen reader announces as one
   * word. Joined here rather than by adding a space to either source, so neither ends with a
   * dangling space when it is the only one present.
   */
  protected readonly emailTemplatesLiveAnnouncement = computed<string>(() =>
    [this.emailTemplatesAnnouncement(), this.emailTemplateSuggestionAnnouncement()].filter((part) => part !== '').join(' ')
  );

  protected readonly emailTemplateSuggestionAnnouncement = computed<string>(() => {
    const id = this.emailTemplateSuggestionId();
    if (id === '' || id !== this.selectedEmailTemplateId()) {
      return '';
    }
    // A template can carry a subject and no name -- it is matched on either -- and announcing an
    // empty string reads as "Template selected for this event: . Choose another", which tells a
    // screen-reader user nothing about what was chosen. Fall back to the subject, then to a
    // neutral phrase rather than a blank.
    const template = this.emailTemplates()?.find((t) => t.id === id);
    const name = (template?.name ?? '').trim() || (template?.subject ?? '').trim() || 'an untitled template';
    const terms = this.emailTemplateSuggestionTermsLabel();
    const matched = terms === '' ? '' : `, matched on ${terms}`;
    return `Template selected for this event: ${name}${matched}. Choose another to override it.`;
  });

  /**
   * The rows the picker actually DRAWS — the first `HUBSPOT_TEMPLATE_RENDER_LIMIT` of them.
   *
   * A computed rather than a slice in the template: `frontend-checklist.md` §4 allows only signal
   * reads, computed values and pipes in a template, and `templates.slice(...)` there would be a
   * method call re-run on every change-detection pass.
   *
   * The full list is NOT discarded — `emailTemplates` still holds every row, which is what
   * `emailTemplateRenderTotal` reports. Capping the render without saying so would present a cut
   * list as a complete one; `emailTemplatesRenderCapped` drives the copy that says otherwise.
   */
  protected readonly emailTemplatesRendered = computed<HubSpotMarketingEmail[]>(() => {
    const templates = this.emailTemplates();
    if (templates === null) return [];
    // RANK BEFORE SLICING. The cap keeps the first N rows, so ranking afterwards could only
    // reorder what survived -- a matching template past the cap would be cut before it could rise,
    // which is exactly the template the operator was looking for.
    const ranked = this.rankTemplatesForSelectedType(templates);
    if (ranked.length <= HUBSPOT_TEMPLATE_RENDER_LIMIT) {
      return ranked;
    }
    const drawn = ranked.slice(0, HUBSPOT_TEMPLATE_RENDER_LIMIT);

    // The SELECTED row is always drawn, even when ranking pushes it past the cap.
    //
    // TWO routes reach that state, and the guard covers both:
    //
    //   - A TYPE CHANGE reranks the list under a selection the operator already made, so with
    //     enough matches for the new type the selected row drops below the cap and vanishes.
    //   - A SUGGESTED template can be cut even as it is pre-selected: ranking and the suggestion
    //     agree on the event half but not the type half, and a tie falls to the server's original
    //     order. Reproduced with a 7-keyword type against 300 rows matching six of them.
    //
    // Either way nothing else notices — `canStageEmail` stays enabled and `onStageEmailSend` still
    // clones the now-invisible template, so the operator stages a clone of something they can no
    // longer see or change, and in the second case the banner announces a pre-selection no visible
    // row carries. Hiding the current choice is the one thing a ranking heuristic must never do.
    //
    // Splicing to the TOP rather than re-ranking: it is the row the operator chose (or was chosen
    // for them), so it belongs where they will look. The cap holds — this replaces a row, never
    // appends one.
    const selectedId = this.selectedEmailTemplateId();
    if (selectedId !== '' && !drawn.some((t) => t.id === selectedId)) {
      const selected = ranked.find((t) => t.id === selectedId);
      if (selected) {
        return [selected, ...drawn.slice(0, HUBSPOT_TEMPLATE_RENDER_LIMIT - 1)];
      }
    }
    return drawn;
  });

  /** How many rows the search returned, as opposed to how many are drawn. */
  protected readonly emailTemplateRenderTotal = computed<number>(() => this.emailTemplates()?.length ?? 0);

  /** Whether the render cap actually bit — i.e. rows were fetched that are not on screen. */
  protected readonly emailTemplatesRenderCapped = computed<boolean>(() => this.emailTemplateRenderTotal() > HUBSPOT_TEMPLATE_RENDER_LIMIT);

  /**
   * The "showing the first N of M" line.
   *
   * States the cap as FACT, unlike the `possiblyTruncated` banner beside it, which says "may be"
   * because a capped 500 and a complete 500 are indistinguishable upstream. Here both numbers are
   * known exactly — the list in hand was measured before slicing — so hedging would understate a
   * certainty. The two are independent and can both show: an unfiltered search can be cut
   * upstream at 500 AND cut again here at the render limit.
   */
  protected readonly emailTemplatesRenderCapMessage = computed<string>(() =>
    this.emailTemplatesRenderCapped()
      ? // "Showing N of M", not "the FIRST N of M". When a selected template ranks past the cap it
        // is spliced to the top, so the drawn rows are that row plus the first N-1 -- and the
        // stronger claim would be false in exactly the case the splice exists for. The count and
        // the total are both still true; only the word "first" was not.
        `Showing ${HUBSPOT_TEMPLATE_RENDER_LIMIT} of ${this.emailTemplateRenderTotal()}. Search to narrow the list.`
      : ''
  );

  /**
   * The brief's built send audience — the prerequisite email dispatch cannot run without.
   *
   * Held separately from the copy because they are independent: an operator can build the
   * audience before writing the email or after, and regenerating copy must not discard a built
   * audience (rebuilding calls Snowflake and several HubSpot creates).
   */
  protected readonly emailAudience = signal<CampaignAudience | null>(null);

  /**
   * Build lifecycle for the REQUEST, not the upstream job.
   *
   * `building` covers the in-flight call only; it returns to `idle` when the 202 lands.
   *
   * There is no poll and no status re-read route, so the audience's `status` is only ever the one
   * the 202 carried. `canStageEmail` reads that rather than this signal because it is the closest
   * thing to an authority available.
   *
   * A row that comes back `building` is therefore TERMINAL in this UI, by design: upstream keeps
   * that state when the outcome is UNCONFIRMED -- a HubSpot list may already exist -- so offering
   * a rebuild would create the duplicate contact list that state exists to prevent. The operator's
   * route out is reconciling the ids in `inclusionSummary`, which is why that summary is rendered
   * verbatim. A status re-read is the real fix and is not in this change.
   *
   * This rests on the build being SYNCHRONOUS from the client's side: `onBuildAudience` awaits the
   * call and sets `emailAudience` only after it resolves, so every `building` row on screen came
   * back on a completed 202 and is genuinely unconfirmed rather than merely in flight. If upstream
   * ever answers `building` for an ordinary async build, the two stop being the same thing and
   * this copy would mislabel one as the other.
   */
  protected readonly emailAudienceState = signal<'idle' | 'building' | 'error'>('idle');

  /** Message for a failed or disabled build — empty while idle or in flight. */
  protected readonly emailAudienceMessage = signal<string>('');

  /** Shared so the three email blocks that need a brief cannot drift apart. */
  protected readonly briefRequiredHint = EMAIL_BRIEF_REQUIRED_HINT;

  /**
   * The brief id the email side has established, if any.
   *
   * Email skips brief persistence on the Plan tab, so unlike the paid side there is no
   * `briefPersistence().briefId` to read. Staging persists on demand and records the id here so a
   * subsequent audience build — which is brief-scoped upstream — has one without persisting twice.
   */
  protected readonly emailBriefId = signal<string>('');

  /**
   * The email type the operator is writing.
   *
   * Held as the TYPE id rather than the stage, because several types share a stage and the
   * operator picked a type -- storing the stage would lose which one they chose, and a reload
   * would show a different label than they selected.
   */
  protected readonly selectedEmailTypeId = signal<string>(DEFAULT_CAMPAIGN_EMAIL_TYPE_ID);

  /** The stage that type generates from — what campaign-service actually takes. */
  protected readonly selectedEmailStage = computed<CampaignEmailStage | undefined>(
    () => CAMPAIGN_EMAIL_TYPES.find((t) => t.id === this.selectedEmailTypeId())?.stage
  );

  /** The full type list, for the selector. */
  protected readonly emailTypes = CAMPAIGN_EMAIL_TYPES;

  /** The chosen template's id — what `hubspotConfig.sourceEmailId` takes on create. */
  protected readonly selectedEmailTemplateId = signal<string>('');

  /**
   * Generated email copy for the brief on screen — LFXV2-3198's `email-copy`.
   *
   * Held here rather than on the brief because the two are generated by different calls at
   * different times: the brief comes from the Plan-tab scrape, the copy is generated on demand in
   * Implement and can be regenerated without re-scraping. Folding it into the brief would make a
   * refine re-run the scrape.
   */
  protected readonly emailCopy = signal<EmailBriefCopy | null>(null);

  /** Generation lifecycle. `generating` covers a first pass and a refine alike. */
  protected readonly emailCopyState = signal<'idle' | 'generating' | 'error'>('idle');

  /** Message for a failed generation — empty while idle or in flight. */
  protected readonly emailCopyError = signal<string>('');

  /**
   * Whether copy can be generated: a brief must exist, because the prompt is instructed to use
   * ONLY supplied event facts and has nothing to work from otherwise.
   */
  protected readonly canGenerateEmailCopy = computed(() => this.emailBriefOutput() !== null && this.emailCopyState() !== 'generating');

  /**
   * Email staging state — LFXV2-3201's create trigger.
   *
   * Separate from the paid side's `creating`/`campaignRows` because the two report DIFFERENT
   * outcomes. Paid creation returns per-platform rows a user can act on; staging an email
   * produces ONE HubSpot draft and nothing to pause, so a row table would imply controls that
   * do not exist (`HubSpotDispatcher` implements no `StatusToggler`).
   *
   * `idle` before any attempt, `staging` while the job runs, then a terminal message. The
   * message is kept as text rather than a boolean because the failure a user can act on
   * ("connect HubSpot", "pick a template") and the one they cannot are both surfaced here.
   */
  protected readonly emailStaging = signal<'idle' | 'staging' | 'done' | 'error'>('idle');

  /** Terminal message for the staging attempt — empty while idle or in flight. */
  protected readonly emailStagingMessage = signal<string>('');

  /**
   * Whether a send can be staged right now.
   *
   * All three are REQUIRED by the upstream contract, not by preference: the brief because
   * creation posts to `/projects/{slug}/briefs/{id}/campaigns` and there is no
   * create-without-a-brief route; the template because `hubspot.go:281-283` refuses a blank
   * `sourceEmailId`; the slug because briefs are project-scoped and authorised per project.
   */
  protected readonly canStageEmail = computed(
    () =>
      this.emailBriefOutput() !== null &&
      this.selectedEmailTemplateId() !== '' &&
      this.activeFoundationSlug() !== '' &&
      // The audience is a real upstream precondition, not just UI copy: campaign-service's
      // `resolveBuiltAudience` refuses to stage when the brief has no BUILT audience. Without
      // this the Stage button is enabled, the HubSpot draft work begins, and the refusal comes
      // back as a generic staging error after the fact.
      //
      // The STATUS, not merely a non-null row: upstream's three states are `building`, `built`
      // and `failed`, and a build that ends in `failed` still yields an audience object. Gating
      // on existence alone would re-admit the exact refusal this guard exists to prevent.
      this.emailAudience()?.status === 'built' &&
      this.emailStaging() !== 'staging'
  );

  /**
   * Whether the channel is usable at all for this project.
   *
   * `enabled: false` is the steady state wherever HubSpot is not connected, not a failure, so it
   * renders as "connect HubSpot" rather than an error. Starts null meaning UNKNOWN — only a
   * response can settle it, and rendering either answer before one arrives would be a guess.
   */
  protected readonly emailChannelEnabled = signal<boolean | null>(null);

  /**
   * The project slug the CURRENT template search was issued against.
   *
   * Separate from `activeFoundationSlug` on purpose. The "not connected" copy names the project
   * that was queried, and the foundation is switchable while a response is in flight — reading
   * the live slug would name whichever foundation the user has since moved to, which is the
   * opposite of the point. Written at dispatch and only by the generation-current response.
   */
  protected readonly emailSearchProjectSlug = signal<string>('');

  /**
   * Names the project the search actually queried, for the "connect HubSpot" empty state.
   *
   * campaign-service answers the same typed 404 for an absent connection row and for a project id
   * that does not exist (`campaign.interface.ts:1223-1226`), so "not connected" and "no such
   * project" are indistinguishable here. Naming the slug is what makes a typo visible instead of
   * being reported as a missing integration.
   *
   * The slug — not the display name — because the slug is the identifier that was sent, and it is
   * the thing that can be mistyped; a name would be resolved from local context and would look
   * correct even when the queried id was wrong.
   */
  protected readonly emailNotConnectedMessage = computed<string>(() => {
    const slug = this.emailSearchProjectSlug();
    // The empty-slug search is refused before dispatch, so this is defensive only: naming nothing
    // is still better than rendering "project ''".
    return slug
      ? `HubSpot is not connected for “${slug}”. Connect it for this foundation to stage an email.`
      : 'Connect HubSpot for this foundation to stage an email.';
  });

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);
  protected readonly activeDeliveryTypeConfig = computed(() => this.deliveryTypes.find((dt) => dt.id === this.selectedDeliveryType()) ?? this.deliveryTypes[0]);

  /**
   * Whether the Email delivery type is the one on screen.
   *
   * One computed rather than repeated `=== 'email'` comparisons, and the template is the
   * reason: the two container bindings are INVERSIONS of each other, which is where a mistake
   * would hide. `isEmail()` / `!isEmail()` reads as the opposition it is.
   */
  protected readonly isEmail = computed(() => this.selectedDeliveryType() === 'email');

  /**
   * The Email side's tab set — a plain field, NOT a computed over the active delivery type.
   *
   * That distinction is the whole point. Both containers stay MOUNTED, so a list keyed on
   * `isEmail()` would describe *the page* rather than *this container*: while Paid Marketing is
   * showing, the hidden Email tablist would render the unfiltered four — including the Optimize
   * button this channel must never offer — and the keyboard handler's bounds would disagree
   * with the DOM it indexes into. A per-container constant cannot drift with ambient state.
   *
   * Email drops **Optimize** because the tab has no meaning here, not because it is unbuilt.
   * Optimize drives keyword and status actions, and `HubSpotDispatcher` implements no
   * `StatusToggler`: campaign create STAGES a draft that a human reviews and sends, so nothing
   * is running to pause. A Pause/Resume would be answered `ErrToggleUnsupported` → 400, over
   * keyword and metrics data that is not this channel's to begin with.
   *
   * Monitor stays, but as a pending panel rather than the paid Monitor component.
   * campaign-service CAN read HubSpot email metrics (`HubSpotDispatcher.ReadMetrics`,
   * LFXV2-3058) — this application has no route to it, so there is nothing to render yet.
   * Stated at both layers deliberately: an earlier version of this comment reasoned from the
   * backend capability straight to a frontend guarantee, and that missing step is exactly what
   * made reusing `MonitoringTabComponent` here look safe. It is not — that component's
   * `PlatformType` is `'google' | 'linkedin' | 'reddit' | 'meta'`.
   */
  protected readonly emailTabs: readonly CampaignTabOption[] = CAMPAIGN_TABS.filter((t) => t.id !== 'optimization');

  /**
   * Rows from the brief's metrics read, narrowed to the email channel.
   *
   * `null` means NOT YET READ, which is distinct from a read that returned no rows: the first
   * renders the loading state, the second says nothing has been staged. Collapsing them into an
   * empty array would report "no emails staged" to someone whose request is still in flight.
   */
  protected readonly emailMetrics = signal<BriefMetrics | null>(null);

  /** `error` covers only a failed REQUEST. A row that could not be measured is a successful read. */
  protected readonly emailMetricsState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  /** Operator-facing text for a failed request — empty in every other state. */
  protected readonly emailMetricsError = signal<string>('');

  /**
   * Screen-reader announcement for the metrics read.
   *
   * The Refresh button's feedback is otherwise purely visual — a spinner appears, numbers change —
   * so a screen-reader user who activates it is told nothing about whether it is running, finished
   * or failed. This mirrors `emailTemplatesAnnouncement`, and its region is mounted outside the
   * `@switch` for the reason documented there: an aria-live element inserted with its text already
   * present is not reliably announced.
   *
   * Empty in `idle`, so it stays silent on the tabs and states where no read has happened.
   */
  protected readonly emailMetricsAnnouncement = computed<string>(() => {
    switch (this.emailMetricsState()) {
      case 'loading':
        return 'Reading email performance';
      case 'error':
        return this.emailMetricsError();
      case 'loaded': {
        const rows = this.emailMetricsRows().length;
        if (rows === 0) {
          return 'No email staged for this brief';
        }
        const measured = this.emailMetricsOkRows().length;
        // Says what was MEASURED against what exists, because that difference is the whole point
        // of the panel and a count alone would imply every row carried numbers.
        return `Email performance updated: ${measured} of ${rows} staged ${rows === 1 ? 'email' : 'emails'} reporting numbers`;
      }
      default:
        return '';
    }
  });

  /**
   * Only the rows this tab is about.
   *
   * A brief is shared across delivery types, so its metrics read returns the paid campaigns too.
   * Rendering those under a tab labelled Email would show Google Ads spend as email performance —
   * numbers that are real, plausible, and about a different campaign entirely, which is the exact
   * substitution the placeholder this panel replaces existed to avoid.
   *
   * Filtered on the upstream platform token `hubspot`, which is why `BriefMetricsRow.platform` is
   * typed `string` rather than `CampaignPlatform` — the ad-platform union has no member for it.
   */
  protected readonly emailMetricsRows = computed<BriefMetricsRow[]>(() => (this.emailMetrics()?.rows ?? []).filter((row) => row.platform === 'hubspot'));

  /**
   * Rows carrying an actual measurement.
   *
   * The predicate reaches all the way to `metrics.email`, and that depth is load-bearing: it must
   * be the SAME predicate the totals are summed over. An earlier version stopped at
   * `metrics !== undefined`, so a row whose `metrics` existed WITHOUT an `email` object passed
   * this filter, was then skipped by the reducer, and was counted on BOTH sides of the
   * partial-coverage comparison — which therefore never fired. The totals silently covered fewer
   * emails than the panel claimed, and where such a row was the only one the reducer's zero seed
   * survived and six confident zeroes rendered as a measurement. That is precisely the
   * substitution this panel exists to prevent, reintroduced one layer in.
   *
   * For a `hubspot` row this shape is a CONTRACT VIOLATION, not an expected state:
   * `internal/platform/hubspot/statistics.go` constructs `Email` unconditionally on every success
   * return, so no upstream path yields an `ok` HubSpot row without it. It is excluded defensively
   * — a row that cannot be measured must not be counted as measured — and the problem bucket
   * below keeps it visible rather than letting it vanish from the panel.
   */
  protected readonly emailMetricsOkRows = computed<BriefMetricsRow[]>(() =>
    this.emailMetricsRows().filter((row) => row.status === 'ok' && row.metrics?.email !== undefined)
  );

  /**
   * Rows that are staged but carry no measurement yet.
   *
   * This is the state #1699 exists to keep visible. campaign-service classifies "HubSpot answered
   * successfully and reported nothing" as `not_ready`, NOT as a failure, because on this channel
   * dispatch stages a DRAFT and a human presses send in HubSpot afterwards — so every read before
   * that moment looks exactly like this. Rendering it as zeros would claim an email was sent to
   * nobody's interest; rendering it as an error would send an operator to investigate a healthy
   * integration. It is neither, and it gets its own row treatment.
   */
  protected readonly emailMetricsPendingRows = computed<BriefMetricsRow[]>(() => this.emailMetricsRows().filter((row) => row.status === 'not_ready'));

  /**
   * Rows whose read could not be completed — surfaced apart from the measured totals.
   *
   * Defined as the COMPLEMENT of measured-and-pending rather than as an allow-list of
   * `connection_problem | failed | unsupported`. An allow-list silently drops anything it does not
   * enumerate, and two such rows exist: an `ok` row missing its `email` object, and any status
   * campaign-service adds later. `BriefMetricsRowStatus` is a closed union in TypeScript, so the
   * compiler cannot catch an upstream addition — with an allow-list the new status matched no
   * bucket, and because `emailMetricsRows()` was non-empty the empty state was suppressed too, so
   * the operator got a header and a Refresh button over nothing. The complement inverts that
   * failure mode from invisible to surfaced, which is the only safe direction for a row the panel
   * does not understand.
   */
  protected readonly emailMetricsProblemRows = computed<BriefMetricsRow[]>(() =>
    this.emailMetricsRows().filter((row) => !(row.status === 'ok' && row.metrics?.email !== undefined) && row.status !== 'not_ready')
  );

  /**
   * Channel totals, summed ONLY over measured rows.
   *
   * Returns `null` when nothing is measured, so the template renders the empty state rather than a
   * row of confident zeroes. `cost_micros` is deliberately absent: this channel bills no per-send
   * cost and the issue is explicit that pacing does not exist here.
   */
  protected readonly emailMetricsTotals = computed<CampaignServiceEmailMetrics | null>(() => {
    const rows = this.emailMetricsOkRows();
    if (rows.length === 0) {
      return null;
    }
    return rows.reduce<CampaignServiceEmailMetrics>(
      (acc, row) => {
        const email = row.metrics?.email;
        // Cannot fire: `emailMetricsOkRows` already requires `metrics.email`. Kept because the two
        // predicates must not drift — a filter and a reducer disagreeing about what "measured"
        // means is exactly the defect this replaced — and because the narrowing is needed anyway.
        if (email === undefined) {
          return acc;
        }
        return {
          sent: acc.sent + email.sent,
          delivered: acc.delivered + email.delivered,
          opens: acc.opens + email.opens,
          clicks: acc.clicks + email.clicks,
          bounces: acc.bounces + email.bounces,
          unsubscribes: acc.unsubscribes + email.unsubscribes,
        };
      },
      { sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 }
    );
  });

  /**
   * Whether every measured row reports nothing sent.
   *
   * `sent === 0` is what separates the two cases the issue insists must not be conflated. HubSpot
   * answered, so this is not "not ready" — but it counted no sends, so opens and clicks of 0 are
   * not a performance result either. Only with `sent > 0` does a 0% open rate mean what it looks
   * like it means.
   */
  protected readonly emailMetricsNothingSent = computed<boolean>(() => {
    const totals = this.emailMetricsTotals();
    return totals !== null && totals.sent === 0;
  });

  /**
   * Rates, computed only where the denominator makes them meaningful.
   *
   * Every rate is `null` rather than 0 when its denominator is 0. A displayed `0.0%` is a claim
   * that the thing was measured and found to be zero; for an email nobody has sent, that claim is
   * false. Open and click rates are taken over DELIVERED rather than sent, which is what HubSpot's
   * own reporting does — an email that bounced was never a chance to open.
   */
  protected readonly emailMetricsRates = computed<{ delivery: number | null; open: number | null; click: number | null; bounce: number | null }>(() => {
    const totals = this.emailMetricsTotals();
    if (totals === null) {
      return { delivery: null, open: null, click: null, bounce: null };
    }
    const perSent = (value: number): number | null => (totals.sent === 0 ? null : (value / totals.sent) * 100);
    const perDelivered = (value: number): number | null => (totals.delivered === 0 ? null : (value / totals.delivered) * 100);
    return {
      delivery: perSent(totals.delivered),
      open: perDelivered(totals.opens),
      click: perDelivered(totals.clicks),
      bounce: perSent(totals.bounces),
    };
  });
  /**
   * Word-boundary matchers, cached by term.
   *
   * The same few patterns were recompiled for every template on every rank -- up to 500 rows,
   * and once per selection click, since the splice makes ranking re-run when the selection
   * changes. Terms come from the event and change only when the brief does, so the cache stays
   * small and needs no invalidation: a new brief simply asks for different keys.
   */
  private readonly boundaryMatchers = new Map<string, RegExp>();

  public constructor() {
    // Discard the persistence state when the selected foundation changes — see
    // `activeFoundationSlug`. The generation bump is what stops a save already in flight for the
    // previous foundation from writing its outcome under the new one; clearing the signal is what
    // removes a banner that already landed.
    //
    // `skip(1)` because `toObservable` replays the CURRENT slug on subscribe, and the foundation
    // the page opened with is not a switch: `projectQueryParamGuard` has already resolved it
    // before this component exists. Without the skip, a brief proceeded in the same tick as the
    // first change detection would have its save dropped by a generation bump that represents
    // nothing. The computed dedupes by value, so only real changes reach here.
    //
    // `briefOutput` and `selectedTab` are deliberately left alone, unlike `resetToPlanning`. The
    // brief describes an EVENT, not a foundation, and throwing away a generated brief on a stray
    // sidebar click would destroy real work to fix a labelling problem. The consequence is that
    // proceeding after a switch files that brief under the newly selected foundation, which is
    // the only foundation the user has actually asked for by then.
    toObservable(this.activeFoundationSlug)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        // Only the DISPLAY counter. `ownershipGeneration` is deliberately not bumped: this
        // handler clears the banner but leaves `knownBriefIds` alone, because the map is keyed by
        // foundation and each one's ids stay valid for it. Bumping it here would make an
        // in-flight save that lands after a switch fail the ownership guard and drop the id of a
        // row it just created — so returning to that foundation and proceeding again would be
        // refused as unowned. A switch relabels which foundation is on screen; it discards
        // nothing, which is exactly the distinction that counter exists to draw.
        this.briefPersistenceGeneration++;
        this.briefPersistence.set(this.idlePersistence);

        // The picker is per-FOUNDATION and must not survive a switch. `searchEmailTemplates`
        // already refuses a MISSING slug so one portal's templates cannot stand in for another's
        // — but a CHANGED slug is the same hazard and that guard does not see it: the results are
        // already on screen, labelled with whichever foundation is now selected.
        //
        // `selectedEmailTemplateId` is the one that must not be missed. It becomes
        // `hubspotConfig.sourceEmailId` on create, so a stale selection stages a send that clones
        // foundation A's email into foundation B's portal — 404 if the user cannot reach it, and
        // silently wrong if they can.
        // Bumping the search generation is what makes the clears below STICK. Clearing the
        // signals alone cannot stop a request already in flight for the previous foundation:
        // it resolves afterwards, still passes `isCurrent()`, and repopulates the list under
        // the new foundation — the cross-portal leak this handler exists to prevent, and the
        // one `searchEmailTemplates` documents as the hazard its guard cannot see.
        this.emailSearchGeneration++;
        // Cleared here too, and this is NOT redundant with the subscribe arms: BOTH of the
        // set-false calls sit INSIDE their `isCurrent()` guards, so a response the generation
        // bump above just invalidated returns before either runs. Without this line the
        // spinner would hang until the user happened to search again — the bump closes the
        // cross-portal leak and would otherwise open a stuck-loading state in its place.
        this.emailTemplatesLoading.set(false);
        this.emailTemplates.set(null);
        this.emailTemplateQuery.set('');
        this.emailTemplateSubmittedQuery.set('');
        this.emailTemplatesTruncated.set(false);
        this.emailChannelEnabled.set(null);
        this.emailTemplatesError.set(null);
        this.selectedEmailTemplateId.set('');
        // The brief-derived state too. `emailBriefId` is scoped to a (project, event) row, and
        // `ensureEmailBriefId` returns the cached id when set -- so carrying it across a
        // foundation switch points the audience build, the copy generation and the staged draft
        // at the PREVIOUS foundation's brief while the page says the new one. Silently, because
        // every call still succeeds against that row.
        this.resetEmailBriefDerivedState();
        // Cleared with the rest: it names the project in the "not connected" copy, and the
        // previous foundation's slug must not survive into a message rendered under the new one.
        this.emailSearchProjectSlug.set('');

        // The campaign list is per-(foundation, brief) and must not survive a switch either. It
        // was written only by `loadBriefCampaigns` and cleared by nothing, so Optimize stayed
        // mounted rendering the PREVIOUS brief's campaigns under the new foundation — with
        // `projectSlug` already switched and `briefId` cleared to '', which is the address every
        // row's pause/resume is sent to. Acting on one of those rows would aim a money-affecting
        // write at a campaign under an address that does not describe it.
        //
        // The generation bump is what makes these clears stick, exactly as above: a list request
        // already in flight for the previous foundation resolves afterwards and would repopulate
        // the panel under the new one.
        this.briefCampaignsGeneration++;
        this.briefCampaigns.set(null);
        this.briefCampaignsStale.set(false);
        this.briefCampaignsToggleEnabled.set(false);
        this.briefCampaignsDemandGenEnabled.set(null);
        // Cleared with the list. A failure banner belongs to the read that produced it; leaving it
        // set would report the previous foundation's outage against a foundation never queried.
        this.briefCampaignsUnavailable.set(false);

        // Reload if the operator is SITTING on the picker. The clears above are correct, but
        // on their own they leave a blank panel in front of someone who never navigated: the
        // entry load lives in `selectTab`, which only runs on a tab transition. Nothing else
        // re-evaluates it after a switch, so the picker stayed empty until they navigated
        // away and back. Guarded, so a switch into a foundation whose channel is off still
        // renders that answer rather than looping on it.
        if (this.selectedDeliveryType() === 'email' && this.selectedEmailTab() === 'implementation') {
          this.loadEmailTemplatesIfNeverAnswered();
        }

        // Same shape one tab over, but the claim is narrower than the picker's above:
        // `resetEmailBriefDerivedState` has already run in this handler, so the previous
        // foundation's numbers are gone either way -- what this prevents is the panel sitting
        // EMPTY until the operator navigates away and back, not stale numbers under a new name.
        // `loadEmailMetrics` re-reads its own context and handles the no-brief case, so it is
        // safe to call unconditionally.
        if (this.selectedDeliveryType() === 'email' && this.selectedEmailTab() === 'insights') {
          this.loadEmailMetrics();
        }

        // Same reasoning for Optimize, and it is the same bug the picker had: the entry load lives
        // in `selectTab`, which only runs on a tab transition, so an operator SITTING on Optimize
        // through a switch would be left with the blank panel the clears above just produced until
        // they navigated away and back. `loadBriefCampaigns` re-reads its own context and handles
        // the no-brief case, so it is safe to call unconditionally here.
        if (this.selectedDeliveryType() === 'paid-marketing' && this.selectedTab() === 'optimization') {
          this.loadBriefCampaigns();
        }
      });

    // Mirror the program control into the signal. A program switch changes the whole
    // brief context (URL scrape, copy), so it resets the brief + returns to planning.
    this.selectorForm.controls.programType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedProgramType()) {
        return;
      }
      this.selectedProgramType.set(value);
      // A restore adopting the brief's OWN program is not the user switching programs, so it must
      // not discard the brief being restored or the ownership recorded for it.
      if (this.adoptingRestoredProgram) {
        return;
      }
      this.resetToPlanning();
    });

    // Mirror the delivery-type control into the signal. Preserve ALL in-progress state on BOTH
    // sides of an Email <-> Paid Marketing round-trip: each container stays mounted (hidden via
    // an inline [style.display] binding, which wins the cascade over the `flex` utility that
    // otherwise overrides [hidden]), so we must NOT touch briefOutput OR either selectedTab.
    // Resetting a tab here would swap that side's inner @switch and destroy the
    // currently-mounted tab component (e.g. ImplementationTabComponent with its own
    // form/budget/creation state); leaving both alone means returning to either delivery type
    // restores the tab it was on, with its state.
    //
    // The two sides keep SEPARATE tab signals rather than sharing one, because their tab sets
    // differ: Email has no Optimize (see emailTabs). A shared signal would leave the page on
    // a tab this side does not render after a switch away from Optimize — a blank panel with a
    // tablist that agrees with nothing.
    this.selectorForm.controls.deliveryType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedDeliveryType()) {
        return;
      }
      this.selectedDeliveryType.set(value);

      // Re-evaluate the picker on RETURN to email, for the reason the foundation-switch handler
      // documents one condition over: resetting a guard's inputs does nothing if nothing runs it.
      // The switch handler's reload is gated on `selectedDeliveryType()` AS IT READS AT THAT
      // MOMENT, so a foundation switch made while the user is on Paid clears the picker and
      // skips the reload — and no later event re-checked it. Coming back to email/Implement then
      // showed a permanently blank panel: `selectTab` never runs (no tab transition), so nothing
      // reloaded until the user navigated tabs or searched by hand.
      //
      // The same never-answered guard, so a channel-off or failed answer is not retried on every
      // round-trip and a healthy list is not re-fetched.
      if (value === 'email' && this.selectedEmailTab() === 'implementation') {
        this.loadEmailTemplatesIfNeverAnswered();
      }

      // Monitor needs the same treatment, and needs it MORE. Both containers stay mounted and
      // `selectedEmailTab` survives a delivery-type round trip, so `selectTab` never fires and
      // nothing re-read the metrics -- an operator returning to a Monitor tab they never left saw
      // whatever was on screen before. Unlike the picker this is not merely stale-looking: these
      // numbers change when a human presses send in HubSpot, entirely outside this app, which is
      // the whole reason the tab is re-read on every entry rather than cached.
      if (value === 'email' && this.selectedEmailTab() === 'insights') {
        this.loadEmailMetrics();
      }
    });
  }

  /**
   * Set the current tab on the container that OWNS the tablist, named explicitly by the caller.
   *
   * Not inferred from `selectedDeliveryType()`. Both containers are mounted, so the hidden one's
   * buttons still dispatch — and a handler that routes by ambient state writes the hidden
   * tablist's click into the VISIBLE side's signal. `display:none` keeps that out of reach of an
   * ordinary pointer or Tab press, but not of a programmatic `.click()`, which is exactly what
   * an E2E locator resolving a duplicated testid performs.
   */
  protected selectTab(tab: CampaignTab, owner: CampaignDeliveryType): void {
    if (owner === 'email') {
      // Narrowed, never cast: `selectedEmailTab` excludes 'optimization' by type, and the only
      // way to arrive here with it is a caller iterating the wrong list — the very bug the
      // exclusion exists to catch, so it must not be asserted away.
      if (tab !== 'optimization') {
        this.selectedEmailTab.set(tab);
        // Load on ENTRY, not only on proceed. The only other call site is
        // `onEmailProceedToImplementation`, so arriving at this tab any other way — clicking
        // it directly, or returning after a foundation switch cleared the list — left an
        // empty box, which this file's own comment calls out as reading like a broken
        // channel. Guarded on `null` so it fires once and does not re-run over a list the
        // operator is already searching, and skipped while a request is in flight.
        if (tab === 'implementation') {
          this.loadEmailTemplatesIfNeverAnswered();
        }
        // Re-read on every entry rather than once, unlike the picker above. The picker's contents
        // change only when someone edits templates in HubSpot; these numbers change the moment a
        // human presses send there, which is precisely why an operator opens this tab.
        if (tab === 'insights') {
          this.loadEmailMetrics();
        }
      }
      return;
    }
    this.selectedTab.set(tab);
    if (tab === 'optimization') {
      // Loaded on ENTRY rather than eagerly: the list is only meaningful once someone is looking
      // at per-campaign controls, and the read costs a query-service round trip. Re-fetched on
      // every entry rather than cached, because a campaign paused in another tab — or indexed
      // since the last look — must not render with a stale status the user then acts on.
      this.loadBriefCampaigns();
    }
    if (tab === 'implementation') {
      // Guarded on "never answered", mirroring `loadEmailTemplatesIfNeverAnswered` on the email
      // path. The capability is a DEPLOYMENT fact, not per-visit state, so re-reading it on every
      // tab entry spends a query-service round trip to learn the same boolean.
      //
      // `null` is exactly the right predicate and needs no extra flag: the foundation-switch
      // effect and `loadBriefCampaigns`' own pre-request clear both reset it to `null`, and a
      // failed read leaves it `null` — so the read still re-fires on every occasion where the
      // answer is genuinely unknown, including a retry after failure.
      if (this.briefCampaignsDemandGenEnabled() === null) {
        this.loadCreateCapabilities();
      }
    }
  }

  /**
   * Roving-tabindex keyboard navigation over one tablist.
   *
   * The owner is passed in for the same reason `selectTab` takes it, plus one specific to this
   * handler: `currentIndex` comes from the firing tablist's `@for`, and the DOM focus lookup
   * below indexes that same tablist's children. If the bounding list came from ambient state
   * instead, those three would be indexing into collections of different lengths — the email
   * tablist passing index 2 against a four-length list would select Optimize and focus nothing.
   */
  protected onTabKeydown(event: KeyboardEvent, currentIndex: number, owner: CampaignDeliveryType): void {
    const tabs = owner === 'email' ? this.emailTabs : this.tabs;
    let newIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = tabs.length - 1;
    }

    if (newIndex !== null) {
      event.preventDefault();
      this.selectTab(tabs[newIndex].id, owner);
      if (isPlatformBrowser(this.platformId)) {
        // `event.target` is typed `EventTarget | null`, and the cast asserted it away. Selecting
        // the tab is the part that matters; moving focus is the enhancement, so a synthetic or
        // retargeted event must not take the whole handler down with it.
        const source = event.target instanceof HTMLElement ? event.target : null;
        const target = source?.parentElement?.children[newIndex] as HTMLElement | undefined;
        target?.focus();
      }
    }
  }

  /**
   * Hand a brief to the Implementation tab.
   *
   * `alreadyPersisted` suppresses the save, and the RESTORE path sets it. A restored brief came
   * out of campaign-service moments ago, so persisting it again is not a no-op that costs one
   * request: `saveBrief` finds the existing row and PUTs, bumping `version` and spending the
   * ETag for a read the user performed. Worse, what it would write is `fromBriefResponse`'s
   * RECONSTRUCTION rather than the stored bytes — `event_details`, `copy`, `keywords` and
   * `targeting` are opaque `Any` in the service design, and anything in them the adapter does
   * not model would be silently replaced by the narrower shape on the way back out. A restore
   * that quietly rewrites the thing it restored is the one outcome this path must not have.
   */
  protected onProceedToImplementation(brief: CampaignBriefOutput, alreadyPersisted = false, restoredApproved = false): void {
    // BEFORE `briefOutput`, not after. Setting the brief first lets the child's effect run with
    // the stale draft still in place — it seeds from the new brief and then immediately restores
    // the old edits over it, which is the outcome this clear exists to prevent.
    // The draft belongs to the brief it was typed against, and the next line replaces that brief.
    // The child's `eventSlug` guard cannot cover this: a user can return to Planning, refine,
    // and proceed again for the SAME event, so the slugs match and stale edits would silently
    // overwrite the copy just generated. Ordinary Implement/Insights tab switches do not come
    // through here, so they keep the draft — which is the whole point of holding it.
    this.implementationDraft.set(null);
    this.briefOutput.set(brief);
    this.selectedTab.set('implementation');
    if (alreadyPersisted) {
      // Bump the generation even though nothing is being saved. `persistBrief` normally does
      // this as its first act, and skipping the save must not also skip the INVALIDATION: a
      // save still in flight for the brief the user just replaced would otherwise match the
      // unchanged generation on return and write its `saved` state and `briefId` onto the
      // restored brief — attributing one brief's id to another. The restored brief is already
      // durable, so the state it lands in is the resting one, not `saving`.
      this.briefPersistenceGeneration++;
      // The restored brief's id is RETAINED, not cleared: it is the page's proof that the brief
      // on screen came out of campaign-service, and the next save sends it so the server will
      // replace that row rather than refusing as unowned (LFXV2-3200). Status stays `off`
      // because nothing is in flight — the id is provenance, not progress.
      const restoredKey = this.ownershipKey(this.activeFoundationSlug(), brief);
      this.briefPersistence.set({
        status: 'off',
        briefId: restoredKey === null ? null : (this.knownBriefIds.get(restoredKey)?.id ?? null),
        message: null,
        // The RESTORED brief's own approval, carried through the restore output. campaign-service
        // refuses a create from an unapproved brief, so filing one as create-ready here would
        // enable a button whose request cannot succeed — the same defect the save path guards,
        // one restore apart. Only this branch is reachable with a restored brief, so the default
        // of false never reaches a genuinely-approved one.
        approved: restoredApproved,
      });
      // AFTER the branch, not before it. This path sets the tab directly, bypassing `selectTab`,
      // so the capability must be asked for here — but the restored brief's id is written by the
      // branch above, and asking first read the PREVIOUS id and guarded out. A restored brief
      // then reached Implementation with the capability permanently unknown.
      this.loadCreateCapabilities();
      return;
    }
    // The create path has no id yet — `persistBrief` mints one — so the read is triggered from
    // its success arm rather than here. See `loadCreateCapabilitiesFor`.
    this.persistBrief(brief);
  }

  /** A brief restored from campaign-service: hand it over WITHOUT writing it back. */
  /**
   * The Email side's handoff, deliberately NOT routed through `onProceedToImplementation`.
   *
   * It sets the email tab and the email brief, which are separate signals — see the
   * delivery-type effect. It also does not persist: brief persistence is keyed on
   * `(foundation, event)` and the email channel's brief shape is still LFXV2-3201's to settle,
   * so saving one now would file a paid-shaped row under an email brief's key.
   */
  protected onEmailProceedToImplementation(brief: CampaignBriefOutput): void {
    this.emailBriefOutput.set(brief);
    this.resetEmailBriefDerivedState();
    this.selectedEmailTab.set('implementation');
    // Load the picker's options on ARRIVAL rather than on first keystroke, so the tab opens with
    // the portal's most recently updated templates already listed. Someone staging a send usually
    // wants a recent one, and an empty box with no options reads as a broken channel.
    this.searchEmailTemplates('');
  }

  /**
   * Build the brief's send audience.
   *
   * Separate action rather than folded into staging because it is EXPENSIVE — it calls Snowflake
   * and several HubSpot creates — and because an operator wants to inspect the provenance
   * (`inclusionSummary`) before sending to a list they did not assemble by hand.
   */
  protected async onBuildAudience(): Promise<void> {
    const brief = this.emailBriefOutput();
    const projectSlug = this.activeFoundationSlug();
    if (brief === null || projectSlug === '') {
      return;
    }

    // Bumped BEFORE any await, like the copy path: every write below runs after one.
    const generation = ++this.emailAudienceGeneration;
    const isCurrent = (): boolean => generation === this.emailAudienceGeneration;

    this.emailAudienceState.set('building');
    this.emailAudienceMessage.set('');

    try {
      const briefId = await this.ensureEmailBriefId(brief, projectSlug);
      if (!isCurrent()) {
        return;
      }
      if (briefId === '') {
        this.emailAudienceState.set('error');
        this.emailAudienceMessage.set('The brief could not be saved, so no audience was built.');
        return;
      }

      const result = await firstValueFrom(this.campaignService.buildAudience(projectSlug, briefId));
      // A BUILT audience for the previous brief would re-enable staging against the wrong one:
      // `canStageEmail` gates on `emailAudience()?.status === 'built'`.
      if (!isCurrent()) {
        return;
      }

      // `enabled: false` is the cutover flag being off — a steady state, not a failure.
      if (!result.enabled) {
        this.emailAudienceState.set('idle');
        this.emailAudienceMessage.set('Audience building is not enabled for this deployment yet.');
        return;
      }

      if (result.error || !result.audience) {
        this.emailAudienceState.set('error');
        this.emailAudienceMessage.set(result.error ?? 'The audience could not be built.');
        return;
      }

      this.emailAudience.set(result.audience);
      this.emailAudienceState.set('idle');
    } catch {
      if (!isCurrent()) {
        return;
      }
      this.emailAudienceState.set('error');
      this.emailAudienceMessage.set('The audience could not be built. Try again.');
    }
  }

  /**
   * Switch the email type.
   *
   * Clears any generated copy, because the copy on screen was written for the PREVIOUS type: its
   * subject, tone and CTA all belong to that stage. Leaving it would show an operator
   * post-event copy under a "CFP Launch" label, and `onStageEmailSend` reads `emailCopy()`
   * unconditionally -- so the mismatched copy is stageable, the same defect a failed
   * regeneration had before it cleared on retry.
   */
  protected onSelectEmailType(typeId: string): void {
    if (typeId === this.selectedEmailTypeId()) {
      return;
    }
    this.selectedEmailTypeId.set(typeId);
    // Invalidate any generate still in flight. Clearing the signals is not enough: the older
    // response resolves afterwards and would repopulate the panel with the previous stage's copy.
    this.emailCopyGeneration++;

    // Re-derive, because the type is the tie-break. Several of one event's templates score
    // identically on the event, and the type is what chooses between them -- so a suggestion made
    // under Registration Push is the wrong answer once the operator switches to CFP Launch. Left
    // alone, the stale template stayed selected and would have been the one staged.
    //
    // Only when the current selection IS the suggestion: a hand-picked template is the operator's
    // and a type change is not permission to replace it.
    const templates = this.emailTemplates();
    if (templates !== null && this.selectedEmailTemplateId() === this.emailTemplateSuggestionId()) {
      this.selectedEmailTemplateId.set('');
      this.applyEventTemplateSuggestion(templates);
    }
    this.emailCopy.set(null);
    this.emailCopyState.set('idle');
    this.emailCopyError.set('');
  }

  /**
   * Generate email copy for the brief.
   *
   * Brief-scoped upstream (`/briefs/{id}/email-copy`), so the brief must be persisted first —
   * shared with the audience build and staging via `ensureEmailBriefId`, so all three actions
   * write at most one brief for the event.
   *
   * Regeneration is just calling this again: upstream composes the prompt from the brief and does
   * NOT persist the result, so a second call is safe and cheap.
   */
  protected async onGenerateEmailCopy(): Promise<void> {
    const brief = this.emailBriefOutput();
    const projectSlug = this.activeFoundationSlug();
    if (brief === null || projectSlug === '') {
      return;
    }

    // Bumped BEFORE any await. Every write below runs after one, and `onSelectEmailType` can
    // change the stage in between — so an older response must be able to recognise that the
    // request it belongs to is no longer the current one.
    const generation = ++this.emailCopyGeneration;
    const isCurrent = (): boolean => generation === this.emailCopyGeneration;

    this.emailCopyState.set('generating');
    this.emailCopyError.set('');
    // Drop the PREVIOUS copy before regenerating. Leaving it would put stale copy on screen beside
    // a "could not be generated" error, and `onStageEmailSend` reads `emailCopy()` unconditionally
    // -- so the operator could stage the old subject and body while being told the regeneration
    // failed.
    this.emailCopy.set(null);

    try {
      const briefId = await this.ensureEmailBriefId(brief, projectSlug);
      if (!isCurrent()) {
        return;
      }
      if (briefId === '') {
        this.emailCopyState.set('error');
        this.emailCopyError.set('The brief could not be saved, so no copy was generated.');
        return;
      }

      const result = await firstValueFrom(this.campaignService.generateEmailCopy(projectSlug, briefId, this.selectedEmailStage()));
      // The stage may have changed while this was in flight. Writing now would put the PREVIOUS
      // stage's copy on screen under the new stage's label — copy that reads plausibly and is
      // simply the wrong kind of email, which `onStageEmailSend` would then clone.
      if (!isCurrent()) {
        return;
      }

      // The cutover flag being off is a steady state, not a failure.
      if (!result.enabled) {
        this.emailCopyState.set('error');
        this.emailCopyError.set('Email copy generation is not enabled for this deployment yet.');
        return;
      }

      if (result.error || !result.copy) {
        this.emailCopyState.set('error');
        this.emailCopyError.set(result.error ?? 'The email copy could not be generated.');
        return;
      }

      this.emailCopy.set(result.copy);
      this.emailCopyState.set('idle');
    } catch {
      if (!isCurrent()) {
        return;
      }
      this.emailCopyState.set('error');
      this.emailCopyError.set('Could not generate the email. Try again.');
    }
  }

  /**
   * Stage the email send — LFXV2-3201's create trigger.
   *
   * TWO upstream calls, in order, because creation is brief-scoped: the route is
   * `/projects/{slug}/briefs/{brief_id}/campaigns`, so a brief id must exist BEFORE create.
   * The email planner never persisted one (it skips the saved-brief lookup entirely, because
   * persistence is keyed on (foundation, event) with no delivery type and the row it would find
   * is a PAID brief), so this persists first and uses the id that comes back.
   *
   * The persist goes through `ensureEmailBriefId`, which consults `knownBriefIds` for a row this
   * session already owns at this (project, event) and RECORDS the row it persists. An earlier
   * version noted that no ownership was established and none was passed; that stopped being true
   * once the email persist began writing the cache, and the reason it had to is the same one the
   * note gave — the paid path reads that cache, so an email save that left it empty created a
   * SECOND brief for an event that already had one while paid went on addressing the first.
   *
   * `platforms: ['hubspot']` is legal here and only here — `CampaignCreateInput.platforms` is
   * typed `CampaignAnyPlatform[]`, the one request shape that admits the email channel.
   */
  protected async onStageEmailSend(): Promise<void> {
    const brief = this.emailBriefOutput();
    const sourceEmailId = this.selectedEmailTemplateId();
    const projectSlug = this.activeFoundationSlug();
    const copy = this.emailCopy();

    // Re-checked rather than trusted from `canStageEmail`: the button is one caller, and a
    // signal can change between the guard and the await below.
    //
    // The audience is re-checked with the OTHERS, not left out of the list. It is the one
    // precondition upstream actively refuses on (`resolveBuiltAudience`), so omitting it here
    // would let the enumeration drift from the guard it mirrors -- and the failure would arrive
    // from HubSpot after the draft work had begun rather than from this early return.
    if (brief === null || sourceEmailId === '' || projectSlug === '' || this.emailAudience()?.status !== 'built') {
      return;
    }

    this.emailStaging.set('staging');
    this.emailStagingMessage.set('');

    // Bumped BEFORE the await below; the reset bumps the same counter to invalidate it.
    const generation = ++this.emailStagingGeneration;
    const isCurrent = (): boolean => generation === this.emailStagingGeneration;

    try {
      // Shared with the audience build via `ensureEmailBriefId`, so the two actions cannot write
      // two briefs for the same event.
      const briefId = await this.ensureEmailBriefId(brief, projectSlug);
      // A reset can land during that await. Abandoning here is what stops the create below --
      // which CLONES a HubSpot draft -- from running against the previous brief.
      if (!isCurrent()) {
        return;
      }

      // A persist that reports success without an id cannot be followed by a create — the id is
      // a PATH segment upstream. Reported as a failure rather than retried, because a retry
      // would post a second brief for the same event.
      if (briefId === '') {
        this.emailStaging.set('error');
        this.emailStagingMessage.set('The brief could not be saved, so the send was not staged. Try again.');
        return;
      }

      // Built field-by-field rather than spread from the brief: `CampaignCreateRequest` is the
      // PAID shape (budget split, dates, keywords, headlines) and a brief carries none of those
      // under `eventDetails`. The email dispatcher reads only the identifiers plus
      // `hubspotConfig`; the paid-only fields are sent empty because the contract requires them
      // present, not because HubSpot consults them.
      const details = brief.eventDetails;
      const request: CampaignCreateRequest = {
        eventName: details.name,
        eventSlug: details.slug,
        countryCode: details.countryCode,
        registrationUrl: details.registrationUrl,
        campaignTypes: [],
        budgetUsd: 0,
        searchBudgetPct: 0,
        startDate: '',
        endDate: '',
        keywords: [],
        headlines: [],
        descriptions: [],
        geoTargets: [],
        platforms: ['hubspot'],
        // Generated copy rides along when it exists (LFXV2-2775). Spread conditionally rather
        // than sent as empty strings: upstream treats a blank subject as "leave the template's
        // own", and sending '' would be indistinguishable from an operator who generated nothing
        // — but it would also mean every staging call claimed to carry copy it did not have.
        hubspotConfig: {
          sourceEmailId,
          ...(copy === null ? {} : { subject: copy.subject, bodyHtml: copy.body }),
        },
      };

      const outcome = await firstValueFrom(this.campaignService.createCampaign(request, projectSlug, briefId));
      // Checked here TOO, not only after the persist above. A reset landing during THIS await
      // leaves the request already sent -- the draft may well exist upstream -- but everything
      // after it belongs to the previous brief: the poll would run under the new context and
      // write `done` or `error` for a job nobody on screen is waiting for. The request cannot be
      // recalled; the state writes can be, and those are what the operator sees.
      if (!isCurrent()) {
        return;
      }

      if (outcome.error) {
        this.emailStaging.set('error');
        this.emailStagingMessage.set(outcome.error);
        return;
      }

      // POLL rather than trusting the ack. `createCampaign` answers 202 with a job id; the
      // HubSpot clone, the audience resolution and the copy application all run in the background
      // job, so reporting "Draft created" here claimed success for work that had not happened --
      // a dispatcher failure read as a created draft. The paid path already polls
      // (`implementation-tab`'s `pollJob`); this is the same contract for email.
      if (!outcome.jobId) {
        // No id to follow. Report the ack honestly rather than inventing an outcome.
        this.emailStaging.set('error');
        this.emailStagingMessage.set('Staging was accepted but returned nothing to track. Check HubSpot before retrying.');
        return;
      }

      this.pollStagingJob(outcome.jobId, projectSlug);
    } catch {
      // Guarded like every other write in this method. A reset mid-stage would otherwise raise a
      // failure banner for a brief nobody is looking at -- and on the email tab that reads as
      // "your staging failed" about work the operator has already navigated away from.
      if (!isCurrent()) {
        return;
      }
      // The cause is not surfaced: a create failure can carry upstream detail, and the job
      // result collapses every dispatcher error to one string anyway.
      this.emailStaging.set('error');
      this.emailStagingMessage.set('Staging failed. Check the HubSpot connection and try again.');
    }
  }

  /**
   * Search the project's HubSpot marketing emails for one to clone.
   *
   * Debounce is deliberately absent: this is called on ARRIVAL and on an explicit Search press,
   * not per keystroke. campaign-service walks every page and matches in-process, so a filtered
   * search is genuinely expensive — firing one per character would be the wrong trade.
   */

  protected searchEmailTemplates(rawQuery: string): void {
    // Trimmed to match what the SERVER actually searches: the controller trims `q` before
    // calling upstream, so a whitespace-only input runs the UNFILTERED portal search. Storing
    // it raw made the empty state read `No templates match "   "` about a search that had no
    // filter at all — the same class of lie as naming the draft query, one boundary further in.
    const query = rawQuery.trim();
    const projectSlug = this.activeFoundationSlug();
    if (projectSlug === '') {
      // The page is reachable by an ED of any foundation and templates are per-project, so a
      // missing slug must not fall back to some other portal's templates.
      this.emailTemplates.set(null);
      // Same reason as the reset below: a stale `false` would render "Connect HubSpot" instead of
      // this message, because the template checks the channel flag first.
      this.emailChannelEnabled.set(null);
      this.emailTemplatesError.set('Select a foundation before searching for a template.');
      return;
    }

    this.emailTemplateQuery.set(query);
    this.emailTemplateSubmittedQuery.set(query);
    // Captured at dispatch, alongside the slug actually passed to the request below, so the
    // "not connected" copy names the project that was queried even if the foundation changes
    // while the response is in flight.
    this.emailSearchProjectSlug.set(projectSlug);
    this.emailTemplatesLoading.set(true);
    this.emailTemplatesError.set(null);
    // Reset alongside the error, not only on a foundation switch. The template checks
    // `emailChannelEnabled() === false` BEFORE the error branch, so a stale false from an earlier
    // response outranks a real failure: after one "not connected" answer, a later transport error
    // still rendered "Connect HubSpot for this foundation" and the user never saw "Could not load
    // templates." Null means "not yet known for this search", which is the truth at this point.
    this.emailChannelEnabled.set(null);

    // Generation guard. Every call is an independent subscribe, so a slow earlier response can
    // land after a newer one and overwrite the list, truncation flag and error while
    // `emailTemplateQuery` already shows the later search. The foundation-switch handler clears
    // these signals but cannot stop an in-flight response from refilling them — under the NEW
    // foundation — which is the cross-portal leak that handler exists to prevent.
    const generation = ++this.emailSearchGeneration;
    const isCurrent = (): boolean => generation === this.emailSearchGeneration;

    this.campaignService
      .searchHubSpotEmails(projectSlug, query)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          if (!isCurrent()) {
            return;
          }
          this.emailTemplatesLoading.set(false);
          this.emailChannelEnabled.set(result.enabled);
          if (!result.enabled) {
            // Not an error: HubSpot simply is not connected for this project, which is the steady
            // state everywhere the channel is not set up.
            this.emailTemplates.set(null);
            return;
          }
          if (result.error) {
            // The service reached HubSpot and HubSpot refused. Leave the list NULL rather than
            // empty — an empty list would claim the portal has no templates.
            this.emailTemplates.set(null);
            this.emailTemplatesError.set(result.error);
            return;
          }
          // A row with no id cannot be selected — `sourceEmailId` takes that value — so it is
          // dropped rather than rendered as a choice that cannot be made.
          const selectable = result.emails.filter((e) => !!e?.id);
          if (selectable.length === 0 && result.emails.length > 0) {
            // The response CARRIED rows and every one of them was unusable. Reporting that as an
            // empty list would render "This portal has no marketing emails yet" — a claim about
            // the portal, made from a response that proves the opposite. The server already drops
            // id-less rows (campaign-service.service.ts), so reaching here means the contract was
            // violated somewhere upstream; that is a read failure, not an empty portal.
            //
            // NULL rather than [], for the same reason the error arms use null: only a search
            // that genuinely came back with nothing can support the empty-portal claim.
            this.emailTemplates.set(null);
            this.emailTemplatesError.set('Could not load templates. Try again.');
            return;
          }
          this.emailTemplates.set(selectable);
          this.emailTemplatesTruncated.set(result.possiblyTruncated);
          this.applyEventTemplateSuggestion(selectable);
        },
        error: () => {
          if (!isCurrent()) {
            return;
          }
          this.emailTemplatesLoading.set(false);
          // NULL, not []. A failed search says nothing about what the portal holds.
          this.emailTemplates.set(null);
          this.emailTemplatesError.set('Could not load templates. Try again.');
        },
      });
  }

  /**
   * Track what is TYPED, not only what was last searched.
   *
   * Without this the input is one-way and `emailTemplateQuery` only changes inside
   * `searchEmailTemplates` — so typing "kubecon" and clicking Search re-ran the PREVIOUS query
   * (empty on arrival), returning the full listing while the box still read "kubecon". The user
   * concludes their search matched everything. It also let the empty-state copy name a different
   * string than the box held.
   */
  protected onEmailTemplateQueryInput(value: string): void {
    this.emailTemplateQuery.set(value);
  }

  /**
   * The single entry point for a USER-initiated search — both the button and Enter.
   *
   * The gate lives here rather than on the button, because `[disabled]` only ever covered the
   * button: Enter called `searchEmailTemplates` directly, so holding it down fired a full portal
   * walk per repeat while the button next to it was visibly disabled. The generation counter
   * discards the late responses but does NOT cancel the requests — each one still walks every
   * page server-side (the interface documents `q` as matched in-process, page by page), so the
   * cost is paid upstream regardless of which answer the UI keeps.
   *
   * Refusing while a search is in flight is safe rather than lossy: the request already running
   * is for whatever the box held when it started, and the operator can search again the moment
   * it answers.
   */
  protected onEmailTemplateSearchSubmit(): void {
    if (this.emailTemplatesLoading()) {
      return;
    }
    this.searchEmailTemplates(this.emailTemplateQuery());
  }

  protected onSelectEmailTemplate(id: string): void {
    this.selectedEmailTemplateId.set(id);
  }

  /** Retry a failed campaign list — the action the failure state exists to offer. */
  protected retryBriefCampaigns(): void {
    this.loadBriefCampaigns();
  }

  protected onRestoreSavedBrief(brief: CampaignBriefOutput, briefId: string, etag: string | null | undefined, approved: boolean): void {
    // Adopt the brief's OWN program first. The lookup is keyed on `(event_slug, project)` and
    // carries no program type, so an Events brief can be offered while the page sits on
    // Education, and restoring it would leave the selector describing one program while the brief
    // on screen belongs to another.
    //
    // It has to happen HERE rather than being left to the user, because the correction is a trap:
    // changing the selector runs `resetToPlanning`, which discards `briefOutput` — so the brief
    // they just restored is thrown away and they are back on an empty Planning tab. (Ownership
    // survives: `resetToPlanning` no longer clears `knownBriefIds`, because the upstream row is
    // still there. It is the BRIEF that is lost, not the right to save it.)
    //
    // The subscription DOES fire for this write — an earlier comment here claimed it saw no
    // change, which was wrong. `adoptingRestoredProgram` is what stops it resetting, rather than
    // this statement happening to run before the ownership write.
    //
    // Driven through the CONTROL, not the signal: the subscription mirrors the control into
    // `selectedProgramType`, so writing the signal alone would leave the visible selector showing
    // the old program.
    if (brief.programType !== undefined && brief.programType !== this.selectedProgramType()) {
      this.adoptingRestoredProgram = true;
      try {
        this.selectorForm.controls.programType.setValue(brief.programType);
      } finally {
        // `finally`, so a throw inside the subscription cannot leave the flag set and turn every
        // later program switch into a silent no-reset.
        this.adoptingRestoredProgram = false;
      }
    }

    // Recorded BEFORE the handoff, so the suppressed-save branch below can put it on the
    // resting state in one place.
    //
    // Filed under the foundation AND the event it was loaded for, like a created id: a restored
    // id names exactly one row, so replaying it to any other project or event would be refused
    // there — or, worse, accepted against a brief this session never loaded.
    const key = this.ownershipKey(this.activeFoundationSlug(), brief);
    if (key !== null) {
      // The load-time validator is RECORDED when the read produced one (LFXV2-3204). A restore
      // is the one path that knows exactly which version the user was shown, so it is the path
      // that can hand the next save a last-seen ETag. `replaceBrief` prefers it over the ETag
      // its own find reads, which is what lets the precondition actually fire: a concurrent
      // editor who moved the row since this load now produces a `stale-brief` refusal instead of
      // being silently overwritten.
      //
      // `absence` is recorded ONLY when there is no validator, because dropping the validator is
      // not neutral bookkeeping like recording one: it LICENSES the next save to overwrite,
      // since with no last-seen ETag the server falls back to its own fresh read and the
      // precondition passes. Handing out that licence for free on every restore is precisely the
      // last-write-wins bug. With an ETag present the save is verified, so no licence is needed
      // and none is granted.
      //
      // When the read yielded NO ETag the classification stays `'overwrite'`, and that is
      // deliberate rather than an oversight. It is still a DECISION — the user was shown the
      // stored content and chose to work from it — which is the distinction this field draws
      // against `'unknown'`, where nothing was displayed and nothing was chosen. Marking it
      // `'unknown'` would refuse the first save after any restore whose read returned no
      // validator, which is this feature's main path and not a conflict anyone can act on.
      //
      // A 412 from the recorded ETag is a speed bump, not a wall: the conflict handler promotes
      // the session to explicit overwrite permission, so the user is told someone else got there
      // first and the next Proceed saves their version over it. That is the chosen behaviour —
      // one honest refusal, then the existing proceed-again path.
      // Bumped for THIS key only. A single session counter would make a restore of event A
      // invalidate a queued save of event B, discarding an id B's own predecessor save created
      // and turning a correct save into an `unowned-brief-exists` refusal. Ownership is keyed by
      // `(project, event)`, so its epoch has to be too.
      this.ownershipEpochs.set(key, (this.ownershipEpochs.get(key) ?? 0) + 1);
      // NORMALISED with `?? null` first, then compared with a strict `=== null`, because the
      // validator originates across an HTTP boundary: an older pod mid-rolling-deploy omits the
      // field and JSON yields `undefined`, a value the declared `string | null` forbids and the
      // wire produces anyway. Collapsing both spellings of absence to `null` up front is what
      // lets the strict comparison below be correct — there is no loose-null invariant here to
      // rely on. Treating `undefined` as "present" would withhold the overwrite licence and
      // refuse the first save after a restore as `unverified-validator`.
      const validator = etag ?? null;
      this.knownBriefIds.set(key, { id: briefId, etag: validator, ...(validator === null ? { absence: 'overwrite' as const } : {}) });
    }
    this.onProceedToImplementation(brief, true, approved);
  }

  /**
   * Read the email channel's metrics for the current brief.
   *
   * Re-read on every entry rather than cached, matching `loadBriefCampaigns` on the paid side and
   * for the same reason: on this channel the numbers change when a HUMAN presses send in HubSpot,
   * entirely outside this app. A cached read would show an operator the state from before the
   * send they just performed, which is the one moment they are most likely to be looking.
   *
   * No `window` is passed. campaign-service resolves a per-platform default, and on this channel
   * the window does not scope the counters at all — it selects which emails are in scope by send
   * date, and the counters returned are then that email's totals TO DATE. Sending a window from
   * here would imply a period the numbers do not cover.
   */
  protected loadEmailMetrics(): void {
    const projectSlug = this.activeFoundationSlug();
    // Fall back to the OWNED id when the signal is empty. `resetEmailBriefDerivedState` clears
    // `emailBriefId`, which parked the tab in `idle` -- and because Refresh is disabled there, an
    // operator returning to Monitor after a reset had no way to load anything at all. The
    // ownership cache survives the reset and names the same row, so the read is recoverable
    // without a re-persist.
    const brief = this.emailBriefOutput();
    const ownershipKey = brief === null ? null : this.ownershipKey(projectSlug, brief);
    const briefId = this.emailBriefId() || (ownershipKey === null ? '' : (this.knownBriefIds.get(ownershipKey)?.id ?? ''));

    // Bumped BEFORE the early return as well as before the request, for the reason
    // `loadBriefCampaigns` gives: the early return is itself a context change ("this context has
    // no brief"), and leaving the counter alone there would let a request dispatched under the
    // PREVIOUS brief land afterwards and still pass `isCurrent()`.
    const generation = ++this.emailMetricsGeneration;
    const isCurrent = (): boolean => generation === this.emailMetricsGeneration;

    // Both are genuine preconditions of the route, not defaults to paper over: the BFF refuses an
    // empty `project` or `brief_id` with a 400. Reporting the missing precondition is more useful
    // than showing the operator that 400.
    if (projectSlug === '' || briefId === '') {
      this.emailMetrics.set(null);
      this.emailMetricsState.set('idle');
      this.emailMetricsError.set('');
      return;
    }

    // Cleared on EVERY entry, before dispatch. The generation counter fixes the LATE response; it
    // does nothing about the window before any response, during which the previous brief's
    // counters would still be on screen under the new one.
    this.emailMetrics.set(null);
    this.emailMetricsState.set('loading');
    this.emailMetricsError.set('');
    this.campaignService
      .getBriefMetrics(projectSlug, briefId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (metrics: BriefMetrics) => {
          if (!isCurrent()) {
            return;
          }
          this.emailMetrics.set(metrics);
          this.emailMetricsState.set('loaded');
        },
        error: () => {
          if (!isCurrent()) {
            return;
          }
          // Left as `null`, NOT as an empty result. An empty result renders as "nothing staged
          // yet", which is a claim about HubSpot this failed request establishes nothing about.
          this.emailMetrics.set(null);
          this.emailMetricsState.set('error');
          this.emailMetricsError.set('Could not read email performance. Retry, or check the HubSpot connection.');
        },
      });
  }

  /**
   * Read the create-time capabilities the Implementation tab gates controls on.
   *
   * Separate from `loadBriefCampaigns` deliberately, even though both read the same response
   * today. That one is an Optimize concern: it needs a persisted `briefId`, it re-fetches on
   * every entry because a status can go stale, and it clears its rows first. None of that is
   * true here — the capability is a deployment fact, it is needed BEFORE a campaign exists, and
   * on the first-create path there may be no brief id at all.
   *
   * So this asks only when it can, and stays silent otherwise: the tab treats an unanswered
   * capability as `null` and withholds the control without touching the user's draft. That is
   * the correct reading of "not known", and it is why this is safe to skip.
   */
  private loadCreateCapabilities(): void {
    this.loadCreateCapabilitiesFor(this.briefPersistence().briefId);
  }

  /**
   * The same read against an explicitly supplied brief id.
   *
   * Needed because the first-create path has no id on the signal yet: the Implementation tab is
   * opened before `persistBrief` resolves, so reading `briefPersistence()` at entry finds `null`
   * and the entry-time call guards itself out. The persist success arm passes its own id here.
   *
   * An EMPTY id is refused here along with `null`, and that is not an oversight. The service
   * does return `demandGenEnabled` for a blank brief id — but the HTTP path never reaches that
   * branch: `campaign.controller.ts` 400s on a blank `brief_id` before calling the service, and
   * `campaign.controller.spec.ts` pins it. Sending one would spend a request per Implementation
   * entry to receive an error, land in the arm below, and set the capability to `null` — the
   * control stays hidden either way, with a spurious 400 added.
   */
  private loadCreateCapabilitiesFor(briefId: string | null): void {
    const projectSlug = this.activeFoundationSlug();
    if (projectSlug === '' || !briefId) return;

    // Ordered by the SHARED capability generation — see `capabilityGeneration` — and checked
    // against the foundation too. The counter orders this against every other capability writer,
    // `loadBriefCampaigns` included; the slug is what makes a response from the previous
    // foundation inapplicable rather than merely old.
    const dispatchedAt = this.capabilityGeneration;
    const mayWrite = (): boolean => dispatchedAt === this.capabilityGeneration && projectSlug === this.activeFoundationSlug();
    this.campaignService
      .listBriefCampaigns(projectSlug, briefId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // ONLY the capability. This must not touch `briefCampaigns` or the staleness flag —
        // those belong to Optimize's own read, and writing them from here would render a list
        // the operator did not ask for and cannot see.
        next: (result) => {
          if (!mayWrite()) return;
          this.capabilityGeneration++;
          this.briefCampaignsDemandGenEnabled.set(result.demandGenEnabled);
        },
        // Cleared to `null`, not left alone and not set `false`. `false` would clear a restored
        // draft's selection on evidence a failed read does not have; leaving the previous value
        // keeps offering the control on the strength of a read that has since started failing.
        // Clears WITHOUT stamping. A failure establishes no capability value, so it must not
        // take the success ordering with it: two reads dispatched together, the first failing,
        // would otherwise advance the token and make the second's valid answer fail `mayWrite`.
        error: () => {
          if (!mayWrite()) return;
          this.briefCampaignsDemandGenEnabled.set(null);
        },
      });
  }

  /**
   * Fetch the campaigns this brief created, for the Optimize tab's per-campaign controls.
   *
   * A failed read is REPORTED, not swallowed. An earlier revision left `briefCampaigns` at `null`
   * on failure, reasoning that an error banner would fire on the ordinary empty case too — but
   * `null` is also what "nothing has been asked yet" means, so a Query Service outage rendered as
   * a blank panel with no indication and no retry, on campaigns that may still be spending. The
   * `briefCampaignsUnavailable` flag is what separates the two: `null` + flag is a failure the tab
   * states and offers a retry for, `null` alone stays "not loaded", and `[]` stays "genuinely
   * empty". Same failure-as-absence class as the ED drawers' `dataUnavailable`.
   *
   * Guarded by a generation counter for the same reason `searchHubSpotEmails` is: the foundation
   * is switchable while a response is in flight, and a late response would otherwise repopulate
   * the list under whichever foundation the user has since moved to — campaigns from one
   * foundation's brief, rendered as another's.
   */
  private loadBriefCampaigns(): void {
    const projectSlug = this.activeFoundationSlug();
    const briefId = this.briefPersistence().briefId;

    // Bumped BEFORE the early return as well as before the request. The early return is itself a
    // context change ("this context has no brief"), and leaving the counter alone there would let
    // a request dispatched under the previous brief land afterwards and still pass `isCurrent()`.
    const generation = ++this.briefCampaignsGeneration;
    const isCurrent = (): boolean => generation === this.briefCampaignsGeneration;
    // The capability is written from here too, under the SHARED answer ordering — see
    // `capabilityGeneration`. Without it an older list read failing after a newer capability read
    // succeeded would still pass `isCurrent` above (its own list generation is untouched by that
    // reader) and reset a live answer to `null`.
    const capabilityDispatchedAt = this.capabilityGeneration;
    const mayWriteCapability = (): boolean => capabilityDispatchedAt === this.capabilityGeneration;

    // Cleared on EVERY entry, before dispatch — not only on the early return below.
    //
    // The generation counter fixes the LATE response; it does nothing about the window before any
    // response. `briefId` is reachable from `onRestoreSavedBrief` → `onProceedToImplementation` →
    // Optimize entry WITHOUT a foundation change, and the foundation-switch effect is the only
    // other place that clears this state — so within one foundation nothing cleared it at all.
    // For the whole round trip the tab rendered brief A's rows while the parent bound brief B's
    // `briefId` beside them, and those rows are CLICKABLE: `campaignRows` derives `action` purely
    // from the docs, so a toggle in that window sends A's campaignId against B's brief — a
    // money-affecting write to an address that does not describe it.
    //
    // A brief blank panel on re-entry is the accepted cost. The list is re-fetched on every entry
    // by design (see `selectTab`), so there was never a cached render to preserve; what changes is
    // that the interim shows "not loaded" instead of the previous answer. Showing another brief's
    // clickable rows is not a trade worth a flicker.
    this.briefCampaigns.set(null);
    this.briefCampaignsStale.set(false);
    this.briefCampaignsUnavailable.set(false);
    this.briefCampaignsToggleEnabled.set(false);
    this.briefCampaignsDemandGenEnabled.set(null);

    if (projectSlug === '' || briefId === null || briefId === '') {
      // No brief id means nothing was persisted this session and no restore supplied one, so
      // there is nothing to list. Left as `null` — not `[]` — so the tab says "not loaded"
      // instead of asserting the brief has no campaigns. The clear above is what leaves it that
      // way; this arm only stops here.
      return;
    }

    this.campaignService
      .listBriefCampaigns(projectSlug, briefId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (!isCurrent()) {
            return;
          }
          this.briefCampaigns.set(result.campaigns);
          this.briefCampaignsStale.set(result.possiblyStale);
          this.briefCampaignsUnavailable.set(false);
          this.briefCampaignsToggleEnabled.set(result.statusToggleEnabled);
          if (mayWriteCapability()) {
            this.capabilityGeneration++;
            this.briefCampaignsDemandGenEnabled.set(result.demandGenEnabled);
          }
        },
        error: () => {
          if (!isCurrent()) {
            return;
          }
          // `null` AND the flag. The list must not keep showing rows the read could not confirm,
          // and the flag is what stops that `null` reading as "not loaded yet".
          this.briefCampaigns.set(null);
          this.briefCampaignsStale.set(false);
          this.briefCampaignsUnavailable.set(true);
          this.briefCampaignsToggleEnabled.set(false);
          // Cleared WITHOUT stamping, for the reason the sibling reader's error arm gives: a
          // failure has established nothing and must not suppress an in-flight success.
          if (mayWriteCapability()) {
            this.briefCampaignsDemandGenEnabled.set(null);
          }
        },
      });
  }

  /**
   * Load the picker when it holds no answer for the current foundation.
   *
   * Called from BOTH paths that can leave it blank: entering the Implementation tab, and a
   * foundation switch while that tab is already open. Fixing only the first left the second
   * broken — the switch handler clears the signals, and nothing re-evaluated a guard that
   * lived inside `selectTab`. Resetting a guard's inputs does nothing if nothing runs it.
   *
   * The four-signal condition distinguishes "never answered" from "answered with a refusal":
   * a channel-off or failed search also leaves `emailTemplates` null, and re-firing on those
   * would retry a refusal on every entry and overwrite the error the operator needs to read.
   */

  private loadEmailTemplatesIfNeverAnswered(): void {
    if (this.emailTemplates() === null && !this.emailTemplatesLoading() && this.emailChannelEnabled() === null && this.emailTemplatesError() === null) {
      this.searchEmailTemplates(this.emailTemplateQuery());
    }
  }

  /**
   * Follow a staging job to a terminal state.
   *
   * `emailStaging` stays 'staging' until the job settles, so the panel shows work in progress
   * rather than a success the dispatcher has not earned. Bounded the same way as the paid path:
   * a job that never settles reports that rather than spinning forever, because a HubSpot draft
   * may exist either way and the operator needs to be told to go look.
   */
  private pollStagingJob(jobId: string, projectSlug: string): void {
    const MAX_POLLS = Math.ceil(300_000 / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    this.stagingJobSubscription?.unsubscribe();
    this.stagingJobSubscription = this.campaignService
      .getCreateResult(jobId, projectSlug)
      .pipe(take(MAX_POLLS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome: CampaignJobOutcome | null) => {
          // `null` is a still-running tick, not an answer.
          if (!outcome) {
            return;
          }
          if (outcome.errors.length > 0) {
            this.emailStaging.set('error');
            this.emailStagingMessage.set(outcome.errors[0]);
            return;
          }

          // The PER-PLATFORM result decides, not just the top-level errors. campaign-service
          // reports a partial outcome as `{ platform: 'hubspot', ok: false, error }` with an EMPTY
          // `errors` array, so checking only the latter announced "Draft created in HubSpot" for a
          // staging that failed -- and the operator would go looking for a draft that is not
          // there. The paid Implementation tab already reads these rows per platform; this path
          // did not.
          const hubspotResult = outcome.platformResults?.find((r) => r.platform === 'hubspot');
          if (hubspotResult !== undefined && !hubspotResult.ok) {
            this.emailStaging.set('error');
            this.emailStagingMessage.set(hubspotResult.error ?? 'The draft could not be created in HubSpot.');
            return;
          }

          // An ABSENT hubspot row is not treated as a failure: `platformResults` is optional on
          // the contract, and an older service that omits it entirely would otherwise report every
          // successful staging as an error. Only an explicit `ok: false` is a failure.
          this.emailStaging.set('done');
          this.emailStagingMessage.set('Draft created in HubSpot. Review and send it from there.');
        },
        error: () => {
          this.emailStaging.set('error');
          this.emailStagingMessage.set('Lost track of the staging job. Check HubSpot before retrying.');
        },
        complete: () => {
          // Ran out of polls without a terminal answer. A draft may exist; say so rather than
          // leaving the panel spinning or claiming a success nothing confirmed.
          if (this.emailStaging() === 'staging') {
            this.emailStaging.set('error');
            this.emailStagingMessage.set('Staging is taking longer than expected. Check HubSpot to see whether the draft was created.');
          }
        },
      });
  }

  /**
   * Order templates by how well they match the selected email type, best first.
   *
   * A SUGGESTION, not a filter. Every template stays in the list and stays selectable: the corpus
   * is whatever the portal happens to hold, an operator may know a template the keywords do not
   * describe, and hiding rows would turn a ranking heuristic into a decision they cannot see or
   * undo. Cloning writes a real HubSpot draft -- the wrong clone inherits the wrong structure, and
   * with a multi-widget template the body cannot be replaced at all.
   *
   * STABLE: ties keep the server's newest-first order, so an unmatched list is byte-identical to
   * what the picker showed before ranking existed.
   */
  private rankTemplatesForSelectedType(templates: HubSpotMarketingEmail[]): HubSpotMarketingEmail[] {
    const keywords = CAMPAIGN_EMAIL_TYPES.find((t) => t.id === this.selectedEmailTypeId())?.keywords ?? [];
    const eventTerms = this.eventTemplateTerms();
    const hasEventTerms = eventTerms.decisive.length > 0 || eventTerms.ranking.length > 0 || eventTerms.year !== '';
    if (keywords.length === 0 && !hasEventTerms) {
      return templates;
    }
    // Score once per row rather than inside the comparator: a comparator that lowercases and
    // scans both operands runs O(n log n) times over strings that never change.
    //
    // ONE scorer for the event half, shared with the suggestion. They diverged in an earlier
    // version -- ranking counted every term equally while the suggestion doubled distinctive ones
    // -- and the two disagreeing is a visible defect, not a nuance: a single-distinctive-term match
    // could be PRE-SELECTED while ranking below enough type-keyword matches to fall outside the
    // 100-row render cap, so the banner announced a suggestion with no highlighted row anywhere in
    // the list. Reproduced with a 7-keyword type (`final-countdown`) against 300 rows matching six
    // of them: the true KubeCon template ranked 3 against their 6 and was not drawn.
    //
    // The EVENT outweighs the type, and deliberately: within a portal running several events,
    // "which event is this" discriminates far harder than "which stage of the sequence". A KubeCon
    // registration push and an MCP Dev Summit one score identically on type, and only the event
    // term separates them -- picking the wrong one clones the wrong branding into a real draft.
    const scored = templates.map((template, index) => ({
      template,
      index,
      score: this.templateKeywordScore(template, keywords) + this.eventMatchScore(template, eventTerms) + this.eventRankBonus(template, eventTerms),
    }));
    // `index` breaks ties, which is what makes this stable across engines rather than relying on
    // Array.prototype.sort's stability guarantee holding for every input shape.
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map((s) => s.template);
  }

  /**
   * Offer the template this portal already uses for this event, if one is identifiable.
   *
   * This is the answer to "how is it done for that event": rather than holding a per-event mapping
   * of our own, it reads the event off the brief and finds the template whose NAME says it belongs
   * to that event. The portal's own naming is the mapping.
   *
   * Three properties, each load-bearing:
   *
   *   - It only ever pre-fills an EMPTY selection, so an operator who has already chosen keeps
   *     their choice across a re-search or an email-type change -- a suggestion that reinstates
   *     itself over a hand-pick is not a suggestion.
   *   - It withholds below `EVENT_TEMPLATE_SUGGESTION_MIN_SCORE`. A pre-selection reads as decided,
   *     so a wrong one is unlikely to be re-examined, and cloning the wrong template puts another
   *     event's branding into a real HubSpot draft.
   *   - It records WHICH terms matched, so the operator can judge the suggestion rather than trust
   *     it. A suggestion whose reasoning is invisible cannot be checked.
   */
  private applyEventTemplateSuggestion(templates: HubSpotMarketingEmail[]): void {
    this.emailTemplateSuggestionId.set('');
    this.emailTemplateSuggestionTerms.set([]);

    const eventTerms = this.eventTemplateTerms();
    // DECISIVE terms only. With no name or slug tokens there is nothing that identifies the event,
    // and city or year matches alone are not evidence it is the right template.
    if (eventTerms.decisive.length === 0 || templates.length === 0) {
      return;
    }

    // Scored on the EVENT alone, not the blended rank. The blended score mixes in type keywords,
    // so a template matching only the type could clear the threshold while saying nothing about
    // which event it belongs to -- the precise confusion this gate exists to prevent.
    // The EVENT decides whether to suggest at all; the TYPE decides which of that event's
    // templates. A portal that runs an event well has several of its emails -- CFP launch,
    // registration push, final countdown -- and they score identically on the event, so a
    // strict `>` over the server's newest-first order picked whichever was edited last. That
    // preselected a CFP-deadline email for an operator who had chosen Registration Push, which
    // is a wrong answer wearing the right event's name. Observed live: the three MCP Dev Summit
    // templates tie at 12 and the newest is a "Days Left to Submit to Speak" CFP email.
    //
    // The type is a TIE-BREAK, never a gate: it cannot rescue a template the event did not
    // identify, and a type that matches nothing leaves the event ordering untouched.
    const typeKeywords = CAMPAIGN_EMAIL_TYPES.find((t) => t.id === this.selectedEmailTypeId())?.keywords ?? [];
    let best: HubSpotMarketingEmail | null = null;
    let bestScore = 0;
    let bestBonus = 0;
    let bestTypeScore = 0;
    for (const template of templates) {
      const score = this.eventMatchScore(template, eventTerms);
      if (score === 0) {
        continue;
      }
      // Ordered tie-breaks, most specific last-resort first: the event decides, then the year
      // (so this year's edition beats last year's -- otherwise they tie and the server's order
      // picks, which pre-selected a previous edition), then the city, then the email type.
      const bonus = this.eventRankBonus(template, eventTerms);
      const typeScore = this.templateKeywordScore(template, typeKeywords);
      const better =
        score > bestScore || (score === bestScore && bonus > bestBonus) || (score === bestScore && bonus === bestBonus && typeScore > bestTypeScore);
      if (better) {
        best = template;
        bestScore = score;
        bestBonus = bonus;
        bestTypeScore = typeScore;
      }
    }

    if (best === null || bestScore < EVENT_TEMPLATE_SUGGESTION_MIN_SCORE) {
      return;
    }

    this.emailTemplateSuggestionId.set(best.id);
    // The DECISIVE terms only. These are what justified offering the suggestion at all, and they
    // are what an operator needs to judge it -- listing a city or year match here would present
    // as a reason something that could never have been sufficient on its own.
    this.emailTemplateSuggestionTerms.set(this.matchedEventTerms(best, eventTerms.decisive));

    // Pre-fill ONLY an untouched selection. `selectedEmailTemplateId` is the operator's, and a
    // suggestion that overwrites a deliberate choice is a bug wearing a feature's clothes.
    //
    // The empty check is the WHOLE guard, deliberately. A separate "was it overridden" flag was
    // written first and removed: the only path that clears the selection is the foundation switch,
    // which resets the brief-derived state in the same pass, so the flag could never be the reason
    // a re-selection was refused. It was unfalsifiable — no mutation of it changed any test — and
    // an unfalsifiable guard reads as protection that is not there.
    if (this.selectedEmailTemplateId() === '') {
      this.selectedEmailTemplateId.set(best.id);
    }
  }

  /**
   * How strongly a template's name says it belongs to THIS event.
   *
   * Long terms count double, because corroboration is the wrong bar for a distinctive brand token.
   * Found against the live portal: "KubeCon North America" reduces to `kubecon|salt|lake|city`,
   * and "KubeCon NA 2026 - Registration" matches only `kubecon` — one hit, which a
   * count-everything-equally score withholds despite the template naming the event unambiguously.
   * A short token like `dev` or `mcp` genuinely does need a second term, since it turns up in
   * unrelated names, so the two cases must not be scored the same.
   */
  private eventMatchScore(template: HubSpotMarketingEmail, terms: EventTemplateTerms): number {
    return this.matchedEventTerms(template, terms.decisive).reduce(
      (score, term) => score + (term.length >= EVENT_TERM_DISTINCTIVE_LENGTH ? EVENT_TERM_WEIGHT * 2 : EVENT_TERM_WEIGHT),
      0
    );
  }

  /**
   * How well a template orders among others the event already identified.
   *
   * City terms and the year live here rather than in the decisive score: they sharpen the choice
   * between templates that all name the event, and are not evidence of the event themselves.
   * Weighted below a single decisive term so they can never reorder a real match beneath a weak
   * one.
   */
  private eventRankBonus(template: HubSpotMarketingEmail, terms: EventTemplateTerms): number {
    const city = this.matchedEventTerms(template, terms.ranking).length;
    const year = terms.year !== '' && this.matchedEventTerms(template, [terms.year]).length > 0 ? 1 : 0;
    return city + year;
  }

  /** The cached boundary matcher for one term, compiled on first use. */
  private boundaryMatcher(term: string): RegExp {
    const cached = this.boundaryMatchers.get(term);
    if (cached !== undefined) {
      return cached;
    }
    // Terms carry only letters and digits (the tokenizer splits on everything else), so there
    // are no regex metacharacters to escape.
    const built = new RegExp(`(^|[^\\p{L}\\p{N}])${term}([^\\p{L}\\p{N}]|$)`, 'u');
    this.boundaryMatchers.set(term, built);
    return built;
  }

  /**
   * Which of the event's terms a template actually matched, for the "why" shown to the operator.
   *
   * Matched on WORD BOUNDARIES, not `includes`. A bare substring test lets a distinctive term match
   * inside a longer word — "KubeConference recap" would score as a KubeCon template and, because a
   * distinctive term suggests on its own, would be pre-selected outright. The boundary is any
   * non-alphanumeric, which keeps every real naming pattern working: `KubeCon + CloudNativeCon`,
   * `KubeCon+CloudNativeCon` with no spaces, `KubeCon: registration`, and `Nairobi, Kenya` all
   * still match. Verified byte-identical against the live portal's templates.
   */
  private matchedEventTerms(template: HubSpotMarketingEmail, eventTerms: readonly string[]): string[] {
    const name = (template.name ?? '').toLowerCase();
    const subject = (template.subject ?? '').toLowerCase();
    return eventTerms.filter((term) => {
      // The boundary class is the SAME alphabet the tokenizer splits on, so "münchen" in a
      // template name is a whole word rather than a letter-run interrupted by the accent.
      // Terms carry only letters and digits (the tokenizer splits on everything else), so there
      // are no regex metacharacters to escape.
      const bounded = this.boundaryMatcher(term);
      return bounded.test(name) || bounded.test(subject);
    });
  }

  /**
   * The terms that identify THIS event in a template's name, derived from the brief.
   *
   * The point of the whole feature: the portal already encodes how each event's email is done, in
   * the names its operators gave those templates. Rather than storing a per-event mapping of our
   * own, this reads the event off the brief and asks HubSpot which templates look like it.
   *
   * The slug is split on its separators and the name on whitespace, then both are filtered:
   * stopwords out (they match everything), tokens under three characters out (too weak to
   * identify an event on their own). What survives is the distinctive part of the event's
   * identity -- "kubecon", "nairobi", "pytorch".
   *
   * The city is included because operators frequently name templates by location where the event
   * brand repeats annually. Themes are NOT: they describe subject matter ("cloud native",
   * "security") and collide across unrelated events in the same portal, which is exactly the
   * false-positive this scoring must avoid.
   */
  private eventTemplateTerms(): EventTemplateTerms {
    const details = this.emailBriefOutput()?.eventDetails;
    if (!details) {
      return { decisive: [], ranking: [], year: '' };
    }
    // SPLIT on punctuation rather than deleting it. Deleting merged "KubeCon+CloudNativeCon" into
    // one unmatchable token, and -- worse -- silently dropped accented letters, so "München"
    // became "mnchen" and could never match a template actually named "München". The event side
    // was mangled while the template side was not, which makes international event names
    // permanently unsuggestable.
    const split = (value: string): string[] => value.split(/[^\p{L}\p{N}]+/u);

    // Lower-cased only. Letters outside a-z are KEPT, and the boundary matcher is built from the
    // same alphabet, so an accented term matches an accented template name.
    const usable = (token: string): boolean => token.length >= 3 && !EVENT_TERM_STOPWORDS.includes(token);

    const decisive = new Set<string>();
    let year = '';
    for (const token of [...split(details.name ?? ''), ...split(details.slug ?? '')]) {
      const cleaned = token.toLowerCase();
      if (EVENT_TERM_YEAR_PATTERN.test(cleaned)) {
        // The year is a TIE-BREAK, never decisive. Dropping it entirely made annual editions
        // score identically, so the server's order picked between "KubeCon NA 2025" and
        // "KubeCon NA 2026" -- last year's template, pre-selected and stageable. Counting it
        // toward the threshold instead would re-admit "Open newsletter 2028" for an
        // "Open Source Summit 2028" brief, which is why it is neither.
        year = year === '' ? cleaned : year;
        continue;
      }
      if (usable(cleaned)) {
        decisive.add(cleaned);
      }
    }

    // The CITY ranks but never decides. "Salt Lake City visitor guide" matched all three of
    // `salt`, `lake`, `city` for a KubeCon brief and scored 9 against a threshold of 6 -- a
    // template with no relation to the event, pre-selected on location words alone. Operators do
    // name templates by city where a brand repeats annually, so the terms are still worth
    // ordering by; they just cannot be the reason a suggestion is offered.
    const ranking = new Set<string>();
    for (const token of split(details.city ?? '')) {
      const cleaned = token.toLowerCase();
      if (usable(cleaned) && !decisive.has(cleaned) && !EVENT_TERM_YEAR_PATTERN.test(cleaned)) {
        ranking.add(cleaned);
      }
    }

    return { decisive: [...decisive], ranking: [...ranking], year };
  }

  /**
   * How many of the type's keywords appear in a template's name or subject.
   *
   * Name and subject are searched INDEPENDENTLY rather than concatenated: joining them would let a
   * keyword match across the boundary between two unrelated fields.
   */
  private templateKeywordScore(template: HubSpotMarketingEmail, keywords: readonly string[]): number {
    const name = (template.name ?? '').toLowerCase();
    const subject = (template.subject ?? '').toLowerCase();
    return keywords.reduce((score, kw) => {
      const needle = kw.toLowerCase();
      return score + (name.includes(needle) || subject.includes(needle) ? 1 : 0);
    }, 0);
  }

  /**
   * Ensure the email brief is persisted and return its id.
   *
   * Email never persists on the Plan tab, but BOTH the audience build and campaign creation are
   * brief-scoped upstream, so each needs an id. Persisting once and caching it here stops the two
   * actions writing two briefs for the same event.
   *
   * Returns '' when the persist could not produce an id; callers must treat that as a failure
   * rather than proceeding with an empty path segment.
   */
  private async ensureEmailBriefId(brief: CampaignBriefOutput, projectSlug: string): Promise<string> {
    // Join a persist already running rather than starting a second. The cache below is only
    // written once the request RESOLVES, so without this two concurrent email actions both find
    // it empty and both save.
    if (this.emailBriefPersistInFlight !== null) {
      return this.emailBriefPersistInFlight;
    }
    const pending = this.persistEmailBrief(brief, projectSlug);
    this.emailBriefPersistInFlight = pending;
    try {
      return await pending;
    } finally {
      // Cleared whatever the outcome: a failed persist must not wedge every later attempt into
      // returning the same rejected promise.
      this.emailBriefPersistInFlight = null;
    }
  }

  /** The persist itself, wrapped by `ensureEmailBriefId`'s in-flight dedup. */
  private async persistEmailBrief(brief: CampaignBriefOutput, projectSlug: string): Promise<string> {
    const known = this.emailBriefId();
    if (known !== '') {
      return known;
    }

    // Name the row if this session already owns it. Briefs are keyed on (project, event) and
    // SHARED across delivery types, so an event whose paid brief was generated or restored in
    // this session already has a row -- and a first-save call, which sends no `brief_id`, is
    // refused against it as `unowned-brief-exists`. That made the email channel unusable for
    // every event the paid side had touched. `knownBriefIds` is the same ownership record the
    // paid save consults; reading it here is what lets email REPLACE rather than only create.
    // `null` when the brief has no event slug -- there is no row to own, so this falls through to
    // a plain first save exactly as before.
    const ownershipKey = this.ownershipKey(projectSlug, brief);
    const owned = ownershipKey === null ? null : (this.knownBriefIds.get(ownershipKey) ?? null);
    const persisted = await firstValueFrom(
      this.campaignService.persistBrief(brief, projectSlug, owned?.id ?? null, owned?.etag ?? null, owned?.absence === 'overwrite')
    );
    const briefId = persisted.briefId ?? '';
    // An id is not enough: campaign-service gates `build-audience` AND campaign creation on the
    // brief having reached `approved`, and `saveBrief` deliberately returns an id with
    // `approved: false` when the approve step failed. Caching that id would make every downstream
    // call fail against a brief this session believes is ready -- and because the cache
    // short-circuits, a retry would never re-attempt the approval that is actually missing.
    if (briefId !== '' && persisted.approved) {
      this.emailBriefId.set(briefId);
      // Record OWNERSHIP too, not just the id. `emailBriefId` is cleared by
      // `resetEmailBriefDerivedState`, so caching only there meant the next save after a Proceed
      // consulted an empty `knownBriefIds`, found no owned row, and CREATED a second brief for a
      // (project, event) that already had one — while the paid path, which reads the same cache,
      // went on addressing the first. Two rows for one event, each believed to be the only one.
      //
      // Same shape the paid save writes: a null etag is UNKNOWN rather than permission, so the
      // overwrite licence is granted only where the write returned no validator at all.
      if (ownershipKey !== null) {
        const validator = persisted.etag ?? null;
        this.knownBriefIds.set(ownershipKey, {
          id: briefId,
          etag: validator,
          ...(validator === null ? { absence: 'overwrite' as const } : {}),
        });
      }
      return briefId;
    }
    return '';
  }

  /**
   * Save the approved brief in the background.
   *
   * Deliberately NOT awaited before the tab switch above: gating the handoff on a network call
   * would trade a working flow for a spinner, and a campaign-service outage would strand the user
   * on the Planning tab with an approved brief and nowhere to take it.
   *
   * The old justification — "nothing in the Implementation tab needs a brief id yet, campaign
   * creation still runs through the vendor-direct path" — is FALSE as of the creation cutover.
   * With the flags on, the create posts to `/briefs/{brief_id}/campaigns` and is terminally
   * refused without that id. The handoff is still not awaited, for the reason above, but the
   * consequence changed: the tab can now be reached before the id exists, so
   * `briefSaveInFlight` disables Create until this save settles. Do not remove that gate on the
   * strength of the sentence this paragraph replaced.
   *
   * `firstValueFrom` rather than `takeUntilDestroyed`: the request must finish and record its
   * outcome even if the user navigates away mid-flight, and one `HttpClient` POST completes on
   * its own. Tearing it down on destroy would abort a save the user was told was in progress.
   *
   * Chained onto `persistChain` so a session's saves run STRICTLY ONE AT A TIME, which is the
   * only place this concurrency can be fixed. `selectTab` is not gated on the save, so the user
   * can return to Planning and proceed again while the first request is open; run both at once
   * and each finds no brief, each POSTs, and one hits the partial unique index on
   * `(project_id, event_slug)`. The server cannot resolve that collision for us — the request
   * that collided is whichever POST arrived second, which is not necessarily the one that
   * started second, so retrying it as a replace would sometimes overwrite a NEWER brief that had
   * already reported success. Serialising here makes the ordering knowable: the second save's
   * find sees the first save's brief and takes the ordinary replace path, so the last Proceed
   * wins, every time.
   *
   * The chain is per-component and never awaited by the caller, so this stays background work.
   * `.catch()` on each link keeps one failed save from poisoning the chain for the next.
   */
  private persistBrief(brief: CampaignBriefOutput): void {
    const generation = ++this.briefPersistenceGeneration;
    // NOT incremented — a save does not discard what the page owns. Captured so the response can
    // tell "nothing was discarded while I was in flight" from "a sibling save queued behind me".
    const ownershipAtSend = this.ownershipGeneration;
    // Read now, not when the chain reaches this link: the foundation selected when the user hit
    // Proceed is the one the brief belongs to. A switch while the save is queued bumps the
    // generation and discards the outcome anyway.
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';

    // Snapshotted for the SAME reason, and here the reason is sharper. A known brief id is the
    // proof that THIS brief came out of storage. Read inside the queued callback instead, a
    // restore landing between Proceed and execution would attach the restored brief's id to a
    // GENERATED brief — handing it ownership of a row it has never seen and inverting the guard
    // into a licence to overwrite, which is precisely what LFXV2-3200 exists to prevent.
    //
    // Only an id issued under THIS foundation is ours to replay; one from another foundation
    // names a row in a different project and would be refused there.
    // The KEY is captured here — it identifies the brief the user hit Proceed on, and reading it
    // later would key this save by whatever is on screen when the queue reaches it.
    //
    // The LOOKUP is deliberately not. Saves are serialised, so this one may sit behind another
    // save of the same event; resolving ownership now would capture null while the predecessor is
    // still in flight, and the queued request would then find the row that predecessor created
    // and be refused as unowned — telling a user their own brief belongs to someone else. It is
    // resolved when this queue item actually begins, below.
    const ownershipKey = this.ownershipKey(projectSlug, brief);
    // Snapshot the ownership EPOCH too. The lookup below is deliberately late so a queued save can
    // pick up an id its predecessor created — but a RESTORE also writes to `knownBriefIds` for the
    // same event, and that is a different source entirely. Without this, a generated brief sitting
    // in the queue would inherit the id of a row it never loaded and silently replace its content.
    //
    // The comment below justifies the late read by the key being `(project, event)`. That covers a
    // different EVENT; it does not cover the same event being restored while this save waits.
    const ownershipEpochAtSend = ownershipKey === null ? 0 : (this.ownershipEpochs.get(ownershipKey) ?? 0);

    // Only once persistence is KNOWN to be on. The flag lives on the server, so the first save
    // of a session cannot know its state until the response arrives — and showing "Saving this
    // brief…" in the meantime would put a persistence banner in front of every user in every
    // environment where the cutover is still dark — no longer the chart default since #1881, but
    // still the state of any override or un-rolled deployment. The cost is
    // that the first save shows no in-flight banner, only its outcome; every later one in the
    // same session shows both.
    if (this.briefPersistenceEnabled()) {
      this.briefPersistence.set({ status: 'saving', briefId: null, message: null, approved: false });
    } else {
      // Clear rather than leave whatever was there. The flag being unknown is the FIRST save of a
      // session — but a first save that FAILED leaves an error banner and does not flip the flag,
      // so the next Proceed took this branch with that banner still on screen and showed the
      // previous brief's failure over the new save until its own request finished.
      //
      // Idle, not `saving`: the reason this branch shows no in-flight banner is unchanged — with
      // the cutover dark, a spinner would appear for every user in an environment where nothing is
      // being saved at all. No longer the chart default since #1881, but still the state of any
      // override or un-rolled deployment.
      this.briefPersistence.set(this.idlePersistence);
    }

    // Set for BOTH branches, unlike the banner above. Whether a save is running has nothing to do
    // with whether we have decided to show a spinner for it.
    //
    // A COUNTER, not a boolean, because saves queue. Both `set(true)` calls run synchronously at
    // enqueue time, but each save appends its own clear to the chain — so with two saves queued,
    // A's clear lands between A finishing and B starting, and B never re-asserts. The flag went
    // false while a save was still pending, which is exactly the window this guard exists to
    // close. The count is decremented in the chain, so it only reaches zero when the queue drains.
    this.pendingBriefSaves += 1;
    this.briefSaveInFlight.set(true);

    this.persistChain = this.persistChain.then(() => {
      // Resolved as this item starts, so a predecessor's created id is already recorded. Safe to
      // read late because it is keyed by `(project, event)`: only a save of THIS event can have
      // filed it, whatever else happened while this one waited.
      // Refuse an id that arrived from a RESTORE after this save was enqueued. A predecessor
      // save's id is fine — that is the case the late read exists for — but a restore means the
      // user loaded a different brief for this event, and this payload never saw it.
      const known =
        ownershipKey === null || (this.ownershipEpochs.get(ownershipKey) ?? 0) !== ownershipEpochAtSend ? null : (this.knownBriefIds.get(ownershipKey) ?? null);
      // `allowFallback` says the caller has no validator BY CHOICE — see `knownBriefIds` for the
      // two paths that set `absence: 'overwrite'`. Without it, an absent validator means
      // "unknown", and the server refuses rather than substituting one it read itself.
      return firstValueFrom(this.campaignService.persistBrief(brief, projectSlug, known?.id ?? null, known?.etag ?? null, known?.absence === 'overwrite')).then(
        (result) => {
          // Latched BEFORE the generation check, unlike everything below it. The check exists to
          // stop a superseded save writing brief-specific state — a `saved` status and a
          // `briefId` — over a brief the page no longer holds. `enabled` is not brief-specific:
          // it is a fact about the deployment, equally true for the brief that was discarded and
          // the one on screen now. Dropping it with the rest would mean a session whose first
          // save happened to resolve after a program switch never learns the cutover is on, and
          // withholds the in-flight banner for the rest of its life.
          //
          // Latched, never cleared, and that direction is the point. During a rollout the two
          // answers come from different replicas, so an `enabled: false` proves only that ONE
          // handler had the flag dark — and a superseded response saying so is the stalest
          // evidence available. Letting it win would put the session back to withholding the
          // banner for good. The reverse mistake costs a `saving` banner on a save that turns
          // out to be a no-op, which is the flicker this latch exists to bound, not to prevent.
          if (result.enabled) {
            this.briefPersistenceEnabled.set(true);
          }

          // Recorded BEFORE the generation check, and deliberately so — the two answer different
          // questions and this round is the third attempt to make one of them serve both.
          //
          // The generation check asks "is this response still worth SHOWING?". Ownership asks
          // "which row does this session hold?", and the answer does not expire because the user
          // navigated. The row exists either way.
          //
          // Both earlier placements were right about one hazard and wrong about the other. Before
          // the check with a bare scalar, a late response re-assigned ownership after
          // `resetToPlanning` had cleared it, so the NEXT brief — a different event — inherited
          // the previous one's row. Moving it after the check fixed that and lost the row a
          // superseded save had created: the next Proceed for the SAME event captured null, found
          // that row and was refused as unowned, telling a user their own brief was someone
          // else's. A comment here once claimed that refusal was "the correct answer"; it is not,
          // it is the bug.
          //
          // Two things make recording here correct. The KEY is `(project, event)` — the server's
          // own identity for a brief — so a late response files its id under the event it
          // actually saved and cannot reach a different event's brief. And the guard is
          // `ownershipGeneration`, which only a DISCARD bumps, so a save superseded by a queued
          // sibling still records while one superseded by a reset does not.
          //
          // Only on a real write — with ONE exception, and the exception is the point. For
          // `unowned-brief-exists` and `stale-brief` the returned id names the row that BLOCKED
          // this save, and adopting it would hand this session ownership of exactly the brief it
          // was told it does not own.
          //
          // `superseded-after-write` is the opposite: that conflict means the write COMMITTED and
          // only its approval was refused, so the id is the row THIS request created. Excluding
          // it lost that id, and with no read path in this phase the next Proceed sent no
          // `brief_id`, found the row, and was permanently refused as unowned — the same
          // stranding the create reconciliation exists to prevent, reached by a different door.
          const wroteTheRow = result.conflict === undefined || result.conflict === 'superseded-after-write';
          if (ownershipAtSend === this.ownershipGeneration && result.enabled && wroteTheRow && result.briefId !== '' && ownershipKey !== null) {
            // The ETag goes with the id: it is this caller's LAST-SEEN version, and sending it
            // on the next save is what makes the If-Match a real precondition rather than a
            // header the save re-derives from its own read.
            // A null etag here is UNKNOWN, not permission: the write returned no validator, or
            // its approval outcome was indeterminate. The next save must not silently fall back
            // to a freshly read one on the strength of it.
            this.knownBriefIds.set(ownershipKey, {
              id: result.briefId,
              etag: result.etag,
              ...(result.etag === null ? { absence: 'unknown' as const } : {}),
            });
          }

          if (generation !== this.briefPersistenceGeneration) return;
          if (!result.enabled) {
            this.briefPersistence.set(this.idlePersistence);
            return;
          }
          // A REFUSED save is not a save. `conflict` arrives with `enabled: true` — the flag is
          // on, the request was served — so keying the banner on `enabled` alone would render
          // "Brief saved." over work that was never written, which is the one thing this banner
          // must never say. It carries `error` rather than a new state: the user's position is
          // exactly that of a failed save, and the remedy is the same.
          if (result.conflict !== undefined) {
            // The two conflicts are different situations and must not share a sentence. Both mean
            // "not written", but `unowned-brief-exists` says this session may not replace that
            // brief at all, while `stale-brief` says it may — someone else just got there first.
            //
            // DROP the stale validator, but only HERE — after the generation check, i.e. only on
            // the path that actually shows the warning. Clearing it is not neutral bookkeeping
            // like recording one: it LICENSES the next save to overwrite, because with no
            // last-seen validator the server falls back to its own fresh read and the precondition
            // stops protecting anyone.
            //
            // An earlier round put this beside the record site, before the check, reasoning that
            // both answer "what does this session hold?". That was wrong. A record is a fact about
            // a write that happened; a clear is permission for a write that has not. If save A is
            // refused with a 412 while save B is already queued, clearing early suppresses A's
            // warning as superseded AND hands B a clean slate — B then overwrites the competing
            // writer with nobody ever told. The permission must not outrun the warning that earns
            // it.
            //
            // The cost is the dead end this clear exists to prevent, in exactly the superseded
            // case: A's validator survives, so a retry re-sends it and fails again. That is the
            // correct trade — a repeated refusal is recoverable and visible, a silent overwrite of
            // someone else's work is neither. The next save the user actually sees refused clears
            // it and gets through.
            // `unverified-validator` promotes to `'overwrite'` for the same reason `stale-brief`
            // does: the user has now BEEN WARNED. That is the whole content of the distinction —
            // an unknown validator is only dangerous while nobody has been told, and the banner
            // has just told them. Without this the refusal is permanent: every retry re-sends the
            // same `'unknown'` marker and is refused identically, while the banner says trying
            // again will work. That is the dead end this file already had to fix once for
            // `stale-brief`, reappearing because a refusal was added without its escape.
            // `superseded-after-write` joins the two above, and it did not always need to. Its
            // message reports a state rather than promising a retry, so it looked like a conflict
            // with nothing to escape from — but a later change made that path RECORD ownership
            // with `absence: 'unknown'`, and an unknown validator refuses the next save. So the
            // user is warned, told their write may have been overtaken, and then silently blocked
            // once when they act on it. The two changes were each fine and wrong together.
            if (
              (result.conflict === 'stale-brief' || result.conflict === 'unverified-validator' || result.conflict === 'superseded-after-write') &&
              ownershipKey !== null
            ) {
              const owned = this.knownBriefIds.get(ownershipKey);
              if (owned !== undefined) {
                // EXPLICIT: the user has just been shown the stale-brief warning. The next save
                // may take the freshly read validator, which is what proceeding means.
                this.knownBriefIds.set(ownershipKey, { id: owned.id, etag: null, absence: 'overwrite' });
              }
            }
            this.briefPersistence.set({
              status: 'error',
              briefId: result.briefId,
              message: this.conflictMessages[result.conflict],
              approved: false,
            });
            return;
          }
          // `saved` is about DURABILITY, and it is honestly earned here — the write landed. But
          // `approved` is a second, separate call, and `saveBrief` reports `approved: false` for a
          // rejected approval, an indeterminate one, or a missing write ETag. Such a row is
          // durable and unusable: campaign creation and audience building both gate on `approved`.
          //
          // Dropping the flag made this session say only "Brief saved." for exactly the row the
          // LOAD path warns about on the next visit — the same defect, one reload apart. Carried
          // as a `message` on the SAVED state rather than a new status or an `error`: describing a
          // durable write as failed would be its own lie, and the banner already renders a message
          // in this state.
          //
          // The capability read needs a brief id, and THIS is where a first create gets one: the
          // Implementation tab opened before the persist resolved, so the entry-time attempt
          // guarded itself out. Without this the create path never learns the capability.
          this.loadCreateCapabilitiesFor(result.briefId);

          this.briefPersistence.set({
            status: 'saved',
            briefId: result.briefId,
            approved: result.approved,
            message: result.approved
              ? null
              : 'This brief was saved but not approved, so campaigns cannot be created from it yet. Ask an administrator to approve the stored brief.',
          });
        },
        // The message is intentionally about DURABILITY, not about the HTTP call: what the user
        // needs to know is that the work in front of them is not saved, and that continuing is
        // fine. Rendering the upstream error text here would say "412 Precondition Failed" to
        // someone who has no way to act on it.
        //
        // Shown even when the flag state is still unknown, unlike the `saving` banner above, and
        // the asymmetry is on purpose. A failed request tells us nothing about the flag — but the
        // sentence is true in both worlds: with the cutover dark the brief is not durable either,
        // which is exactly what it says. Suppressing it until the state is known would instead
        // swallow the very first failure of a live cutover, silently.
        //
        // Rejections are absorbed here rather than propagating, so one failed save cannot leave
        // the chain in a rejected state and take every later save down with it.
        () => {
          if (generation !== this.briefPersistenceGeneration) return;
          this.briefPersistence.set({
            status: 'error',
            briefId: null,
            message: 'This brief could not be saved — it will be lost if you reload. You can continue setting up the campaign.',
            approved: false,
          });
        }
      );
    });

    // TERMINAL catch, and the reason it is here rather than only on the request. The two-argument
    // `.then(onFulfilled, onRejected)` above handles a rejected REQUEST, but a throw inside the
    // success handler — a mapping bug, an unexpected shape — rejects `persistChain` itself. The
    // chain is the queue, so a rejected chain means every later Proceed in the session silently
    // never sends a request at all: no banner, no error, just nothing saved.
    //
    // The doc comment above claimed each link had a `.catch()`. It did not; there were zero in
    // this file. Swallowing here restores the property that comment described — one failed save
    // cannot poison the queue for the next.
    this.persistChain = this.persistChain.catch(() => {
      // Absorbing the rejection keeps the queue alive; it must not also leave the USER on a
      // spinner. A throw in the success handler skips both `.then` arms, so nothing else ever
      // clears `saving` — the banner reads "Saving this brief…" for the rest of the session while
      // the brief is not durable, which is the one state this banner must never show falsely.
      //
      // Generation-gated like the two arms above: a throw belonging to a superseded brief must
      // not stamp an error over whatever owns the signal now.
      if (generation === this.briefPersistenceGeneration) {
        this.briefPersistence.set({
          status: 'error',
          briefId: null,
          message: 'This brief could not be saved — it will be lost if you reload. You can continue setting up the campaign.',
          approved: false,
        });
      }
    });

    // Cleared AFTER the terminal catch, so it runs on every outcome — success, refusal and throw
    // alike. Putting it in the success arm would leave the flag stuck on after a failure, which
    // disables Create for the rest of the session.
    //
    // NOT generation-gated, unlike the banner writes above. This says "no save is running", and
    // that is true of the whole component once the chain drains — gating it on generation would
    // leave the flag set forever whenever a superseded save is the last to finish.
    //
    // Decrement-and-test, so a save queued behind this one keeps the flag set: with two enqueued,
    // this clear belongs to A and runs immediately before B's request starts.
    this.persistChain = this.persistChain.then(() => {
      this.pendingBriefSaves = Math.max(0, this.pendingBriefSaves - 1);
      this.briefSaveInFlight.set(this.pendingBriefSaves > 0);
    });
  }

  /** The `(foundation, event)` pair the server keys a brief on, as one map key. */
  private ownershipKey(projectSlug: string, brief: CampaignBriefOutput): string | null {
    const eventSlug = brief.eventDetails?.slug ?? '';
    // Trim to TEST emptiness, never to build the key — `deriveEventSlug` returns the untrimmed
    // original and that exact string is what goes on the wire as `event_slug`, which
    // campaign-service compares exactly. Keying on the trimmed form would collapse `" a "` and
    // `"a"` — two separate stored briefs — into one entry, and after the second replaced the
    // first, saving the other would send the wrong brief_id and be refused as unowned.
    if (eventSlug.trim().length === 0) {
      return null;
    }
    // No derivable event slug means no row can be named, so there is no ownership to record or
    // claim. Returning null keeps that case out of the map rather than filing it under a key
    // that would collide with every other unslugged brief.
    //
    // A newline separator, not a hyphen: both slugs are drawn from `[a-z0-9-]`, so a separator
    // from that set could be produced by the slugs themselves and let `("a-b", "c")` collide
    // with `("a", "b-c")`.
    return `${projectSlug}\n${eventSlug}`;
  }

  /**
   * Discard both sides' briefs and return both to Plan.
   *
   * BOTH, not just the visible one. A program switch changes the brief context for every
   * delivery type — the URL scrape and the generated copy are program-specific — and the two
   * containers stay mounted, so resetting only the side on screen leaves an Events brief sitting
   * under Education on the other, waiting to be handed to Implement the next time the user
   * switches delivery type.
   */
  private resetToPlanning(): void {
    // Before clearing, so an in-flight save for the brief being discarded cannot write its
    // outcome back over the reset state.
    this.briefPersistenceGeneration++;
    this.ownershipGeneration++;
    this.briefOutput.set(null);
    this.briefPersistence.set(this.idlePersistence);
    // Ownership deliberately SURVIVES. `resetToPlanning` discards the brief on screen, which is
    // right — but the row it created upstream still exists, and dropping its id means the next
    // Proceed for that same event is refused as `unowned-brief-exists` with no read path here to
    // recover. A program switch away and back was enough to strand a brief this session made.
    //
    // Nothing else needs the clear: the keys are `(project, event)`, so no other event can
    // inherit an id, and `ownershipGeneration` (bumped just above) already stops a late response
    // re-filing after a discard. The clear was defending against a hazard the key shape and the
    // generation counter already cover.
    // Cleared, unlike ownership above. The distinction is what each thing REFERS to: ownership
    // names a row that outlives this page, so dropping it strands durable state. A draft is the
    // edits to the brief being discarded — keeping it would replay the old copy over whatever is
    // generated next. The child's `eventSlug` guard would catch a DIFFERENT event, but not the
    // same event re-generated, which is exactly what Start Over does.
    this.implementationDraft.set(null);
    this.selectedTab.set('planning');
    this.emailBriefOutput.set(null);
    this.resetEmailBriefDerivedState();
    this.selectedEmailTab.set('planning');
  }

  /**
   * Drop everything derived from the PREVIOUS email brief.
   *
   * `emailBriefId` is the one that matters: `ensureEmailBriefId` returns the cached id when it is
   * set, so leaving it behind makes the audience build, the copy generation and the staged draft
   * all target the previous event's brief row -- silently, because every call still succeeds. The
   * rest are cleared for the ordinary reason that they describe a brief that is no longer on screen.
   */
  private resetEmailBriefDerivedState(): void {
    // `selectedEmailTypeId` is deliberately NOT cleared, unlike every signal below it. It is the
    // operator's choice rather than state derived from the brief, and someone working an event's
    // send sequence usually wants the type to persist across briefs. Nothing stale survives with
    // it: the generated copy IS cleared here, so the next generation runs against the new brief.
    this.emailBriefId.set('');
    this.emailAudience.set(null);
    this.emailAudienceState.set('idle');
    this.emailAudienceMessage.set('');
    this.emailCopy.set(null);
    this.emailCopyState.set('idle');
    this.emailCopyError.set('');
    // Invalidate everything already in flight. Clearing the signals cannot reach a request
    // still on the wire: a copy or audience response landing after this reports work for the
    // PREVIOUS brief -- and for the audience that is not merely stale, it re-enables staging,
    // since `canStageEmail` gates on the audience status. Unsubscribing the poll below is the
    // same idea for the one path that owns a subscription.
    this.emailCopyGeneration++;
    this.emailAudienceGeneration++;
    this.emailStagingGeneration++;
    // Drop the shared persist too. It is keyed to the brief that started it, so a caller joining
    // it AFTER this reset would receive the PREVIOUS brief's id and address every later write to
    // the wrong row -- the dedup turning into a correctness bug precisely because it succeeded.
    // The in-flight request is left to finish; only the promise other callers can join is cut.
    this.emailBriefPersistInFlight = null;

    // Cancel the poll, do not merely relabel it. Setting the signal back to `idle` leaves the
    // subscription running, so a job settling after a new brief or a foundation switch still
    // writes `done` or `error` — announcing a HubSpot draft that belongs to the PREVIOUS brief as
    // though it were this one's.
    this.stagingJobSubscription?.unsubscribe();
    this.stagingJobSubscription = null;
    this.emailStaging.set('idle');
    this.emailStagingMessage.set('');
    // Cleared with the rest of the brief-derived state. These counters belong to ONE brief's
    // campaigns; leaving them set would render the previous brief's sends under the new one.
    // Back to `null`/`idle` rather than an empty result, so the panel reads "nothing staged yet"
    // only when a read actually said so.
    //
    // The generation bump is what makes the clear STICK. Clearing the signals does nothing to a
    // request already in flight: start a read on foundation A, switch away and back, and A's
    // response resolves afterwards still holding the generation it was issued under, so
    // `isCurrent()` passes and it writes A's rows into a panel now labelled B. The counter is the
    // only thing that can tell those two apart.
    this.emailMetricsGeneration++;
    this.emailMetrics.set(null);
    this.emailMetricsState.set('idle');
    this.emailMetricsError.set('');
    // The chosen template belongs to the brief that chose it. Left set, it survives into the next
    // event in the same foundation, where it is both WRONG (a template for the previous event) and
    // silently suppresses the new suggestion, since the derivation only ever fills an empty
    // selection. That is the feature failing exactly where it is most useful -- the second event.
    this.selectedEmailTemplateId.set('');
    // The suggestion is derived from THIS brief's event, so it and the override that rejected it
    // both belong to the brief. Carrying the override into a new event would suppress a suggestion
    // the operator has never seen.
    this.emailTemplateSuggestionId.set('');
    this.emailTemplateSuggestionTerms.set([]);
  }
}
