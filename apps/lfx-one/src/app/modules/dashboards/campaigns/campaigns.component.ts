// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { CAMPAIGN_DELIVERY_TYPES, CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type {
  CampaignBriefOutput,
  CampaignBriefPersistenceState,
  CampaignBriefPersistResult,
  CampaignDeliveryType,
  CampaignProgramType,
  CampaignTab,
  CampaignTabOption,
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { firstValueFrom, skip } from 'rxjs';

import { SelectComponent } from '../../../shared/components/select/select.component';
import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [ReactiveFormsModule, SelectComponent, PlanningTabComponent, ImplementationTabComponent, MonitoringTabComponent, OptimizationTabComponent],
  templateUrl: './campaigns.component.html',
  styleUrl: './campaigns.component.scss',
})
export class CampaignsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly campaignService = inject(CampaignService);
  private readonly projectContextService = inject(ProjectContextService);

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
   * persistence UI at all". A disabled cutover is the default in every environment, so it must
   * look exactly like the ordinary case rather than like a degraded one.
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
   * - `'overwrite'` — the user was shown a stale-brief warning and proceeded anyway. Permission
   *   is real, so falling back to the freshly read validator is what they asked for.
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
  private readonly activeFoundationSlug = computed(() => this.projectContextService.activeContext()?.slug ?? '');

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
      }
      return;
    }
    this.selectedTab.set(tab);
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
  protected onProceedToImplementation(brief: CampaignBriefOutput, alreadyPersisted = false): void {
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
        // `off` never gates the create on approval (that is the legacy path's state too), so this
        // is false-as-not-applicable rather than a claim the restored brief is unapproved.
        approved: false,
      });
      return;
    }
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
    this.selectedEmailTab.set('implementation');
  }

  protected onRestoreSavedBrief(brief: CampaignBriefOutput, briefId: string): void {
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
      // No ETag from a restore: the read path deliberately drops the load-time validator
      // (LFXV2-3204). Classified `'overwrite'` rather than `'unknown'`, and the distinction is
      // the one the base branch draws — whether anyone DECIDED to save without a validator.
      //
      // A restore is a decision. The user was shown the stored brief's content and chose to work
      // from it, so the page knows which version it is editing even though it was not handed the
      // token for it. That is unlike an indeterminate write, where nothing was displayed and
      // nothing was chosen. Marking it `'unknown'` would refuse the first save after every
      // restore, which is this feature's main path.
      //
      // The residual risk is real and is what LFXV2-3204 closes: another writer changing the row
      // between the load and the save is overwritten rather than producing a 412. That is a
      // narrower window than the unknown case — it needs a concurrent editor, not merely a lost
      // response — and the user has at least seen the content they are replacing.
      // Bumped for THIS key only. A single session counter would make a restore of event A
      // invalidate a queued save of event B, discarding an id B's own predecessor save created
      // and turning a correct save into an `unowned-brief-exists` refusal. Ownership is keyed by
      // `(project, event)`, so its epoch has to be too.
      this.ownershipEpochs.set(key, (this.ownershipEpochs.get(key) ?? 0) + 1);
      this.knownBriefIds.set(key, { id: briefId, etag: null, absence: 'overwrite' });
    }
    this.onProceedToImplementation(brief, true);
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
    // environment where the cutover is still dark, which is all of them by default. The cost is
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
      // the cutover dark, which is the default everywhere, a spinner would appear for every user
      // in an environment where nothing is being saved at all.
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
      // `allowFallback` says the caller has no validator BY CHOICE — the stale-brief warning was
      // shown and the user proceeded. Without it, an absent validator means "unknown", and the
      // server refuses rather than substituting one it read itself.
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
    this.selectedTab.set('planning');
    this.emailBriefOutput.set(null);
    this.selectedEmailTab.set('planning');
  }
}
