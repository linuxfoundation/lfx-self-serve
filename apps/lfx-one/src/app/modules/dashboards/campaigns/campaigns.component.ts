// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { CAMPAIGN_DELIVERY_TYPES, CAMPAIGN_PROGRAM_TYPES, CAMPAIGN_TABS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignBriefPersistenceState, CampaignDeliveryType, CampaignProgramType, CampaignTab } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { firstValueFrom, skip } from 'rxjs';

import { ButtonComponent } from '../../../shared/components/button/button.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ImplementationTabComponent } from './components/implementation-tab/implementation-tab.component';
import { MonitoringTabComponent } from './components/monitoring-tab/monitoring-tab.component';
import { OptimizationTabComponent } from './components/optimization-tab/optimization-tab.component';
import { PlanningTabComponent } from './components/planning-tab/planning-tab.component';

@Component({
  selector: 'lfx-campaigns',
  imports: [
    ReactiveFormsModule,
    SelectComponent,
    ButtonComponent,
    PlanningTabComponent,
    ImplementationTabComponent,
    MonitoringTabComponent,
    OptimizationTabComponent,
  ],
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
  private readonly idlePersistence: CampaignBriefPersistenceState = { status: 'off', briefId: null, message: null };

  protected readonly selectedTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly selectedDeliveryType = signal<CampaignDeliveryType>('paid-marketing');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);
  protected readonly briefPersistence = signal<CampaignBriefPersistenceState>(this.idlePersistence);

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
  /**
   * The campaign-service brief id this session has established ownership of, or null.
   *
   * Set by a SUCCESSFUL save: creating a brief is the strongest proof of ownership there is, and
   * without recording it the second Proceed of a session is refused as unowned — a user editing
   * and re-proceeding would be told their own brief belongs to someone else. In this phase that
   * is the only way it becomes non-null, since persistence is write-only and nothing can load an
   * existing brief; LFXV2-3108 adds the read and a second source.
   *
   * Cleared by `resetToPlanning` with the brief it belonged to. A stale id would let the NEXT
   * brief — a different event — claim ownership of the previous one's row.
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
   * rather than something each future code path has to remember.
   *
   * An earlier revision keyed only the foundation, on the premise that the event half was covered
   * because "every event change goes through `resetToPlanning`". That premise is false —
   * `selectTab` sets the tab directly, so returning to Planning by clicking the tab recreates the
   * planning form without any reset. Save event A, click Planning, generate a brief for event B:
   * with a foundation-only key, B's save carries A's id and the server, given a name it
   * recognises, accepts an overwrite of a brief this session never approved as B.
   *
   * The event half is derived exactly as the write path derives the key it sends
   * (`deriveEventSlug` in `campaign-service.service.ts`): `eventDetails.slug` EXACTLY as
   * stored, with trimming used only to test emptiness — that helper returns the untrimmed
   * original, and that exact string is what goes on the wire as `event_slug`. It is duplicated rather than imported because that module is SERVER-side and this
   * component runs in the browser; deriving it any other way would let the lookup and the request
   * disagree about which row is being claimed, so the two must be changed together.
   */
  private knownBriefIds = new Map<string, string>();

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

  protected readonly activeProgramTypeConfig = computed(() => this.programTypes.find((pt) => pt.id === this.selectedProgramType()) ?? this.programTypes[0]);
  protected readonly activeDeliveryTypeConfig = computed(() => this.deliveryTypes.find((dt) => dt.id === this.selectedDeliveryType()) ?? this.deliveryTypes[0]);

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
      this.resetToPlanning();
    });

    // Mirror the delivery-type control into the signal. Preserve ALL in-progress
    // Paid Marketing state across an Email round-trip: Email is a "coming soon"
    // placeholder, and the paid-marketing container stays mounted (hidden via an inline
    // [style.display] binding, which wins the cascade over the `flex` utility that
    // otherwise overrides [hidden]), so we must NOT touch briefOutput OR selectedTab.
    // Resetting selectedTab here would swap the inner @switch and destroy the
    // currently-mounted tab component (e.g. ImplementationTabComponent with its own
    // form/budget/creation state); leaving it alone means returning to Paid Marketing
    // restores the same tab and its state.
    this.selectorForm.controls.deliveryType.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value === this.selectedDeliveryType()) {
        return;
      }
      this.selectedDeliveryType.set(value);
    });
  }

  protected selectTab(tab: CampaignTab): void {
    this.selectedTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let newIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      newIndex = (currentIndex + 1) % this.tabs.length;
    } else if (event.key === 'ArrowLeft') {
      newIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
    } else if (event.key === 'Home') {
      newIndex = 0;
    } else if (event.key === 'End') {
      newIndex = this.tabs.length - 1;
    }

    if (newIndex !== null) {
      event.preventDefault();
      this.selectTab(this.tabs[newIndex].id);
      if (isPlatformBrowser(this.platformId)) {
        const target = (event.target as HTMLElement).parentElement?.children[newIndex] as HTMLElement | undefined;
        target?.focus();
      }
    }
  }

  protected switchToPaidMarketing(): void {
    this.selectorForm.controls.deliveryType.setValue('paid-marketing');
  }

  protected onProceedToImplementation(brief: CampaignBriefOutput): void {
    this.briefOutput.set(brief);
    this.selectedTab.set('implementation');
    this.persistBrief(brief);
  }

  /**
   * Save the approved brief in the background.
   *
   * Deliberately NOT awaited before the tab switch above. Nothing in the Implementation tab
   * needs a brief id yet — campaign creation still runs through the vendor-direct path — so
   * gating the handoff on a network call would trade a working flow for a spinner, and a
   * campaign-service outage would strand the user on the Planning tab with an approved brief
   * and nowhere to take it.
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

    // Snapshotted alongside the slug, and for a sharper reason: read inside the queued callback
    // instead, a save that completed while THIS one waited would hand its id to a different
    // brief — ownership of a row this payload has never seen.
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

    // Only once persistence is KNOWN to be on. The flag lives on the server, so the first save
    // of a session cannot know its state until the response arrives — and showing "Saving this
    // brief…" in the meantime would put a persistence banner in front of every user in every
    // environment where the cutover is still dark, which is all of them by default. The cost is
    // that the first save shows no in-flight banner, only its outcome; every later one in the
    // same session shows both.
    if (this.briefPersistenceEnabled()) {
      this.briefPersistence.set({ status: 'saving', briefId: null, message: null });
    }

    this.persistChain = this.persistChain.then(() => {
      // Resolved as this item starts, so a predecessor's created id is already recorded. Safe to
      // read late because it is keyed by `(project, event)`: only a save of THIS event can have
      // filed it, whatever else happened while this one waited.
      const knownBriefId = ownershipKey === null ? null : (this.knownBriefIds.get(ownershipKey) ?? null);
      return firstValueFrom(this.campaignService.persistBrief(brief, projectSlug, knownBriefId)).then(
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
          // Only on a real write: a refused save names the row that BLOCKED it, and adopting that
          // id would hand this session ownership of exactly the brief it was told it does not own.
          if (
            ownershipAtSend === this.ownershipGeneration &&
            result.enabled &&
            result.conflict === undefined &&
            result.briefId !== '' &&
            ownershipKey !== null
          ) {
            this.knownBriefIds.set(ownershipKey, result.briefId);
          }

          if (generation !== this.briefPersistenceGeneration) return;
          if (!result.enabled) {
            this.briefPersistence.set(this.idlePersistence);
            return;
          }
          // A REFUSED save is not a save. `conflict` arrives with `enabled: true` — the flag is
          // on and the request was served — so keying the banner on `enabled` alone renders
          // "Brief saved." over work that was never written, which is the one thing this banner
          // must never say. It surfaces as `error` because the user's position is exactly that
          // of a failed save, and the remedy is the same.
          if (result.conflict !== undefined) {
            this.briefPersistence.set({
              status: 'error',
              briefId: result.briefId,
              message: 'This event already has a saved brief that was not opened here, so this one was not saved over it.',
            });
            return;
          }
          this.briefPersistence.set({ status: 'saved', briefId: result.briefId, message: null });
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
          });
        }
      );
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

  private resetToPlanning(): void {
    // Before clearing, so an in-flight save for the brief being discarded cannot write its
    // outcome back over the reset state.
    this.briefPersistenceGeneration++;
    this.ownershipGeneration++;
    this.briefOutput.set(null);
    this.briefPersistence.set(this.idlePersistence);
    this.knownBriefIds.clear();
    this.selectedTab.set('planning');
  }
}
