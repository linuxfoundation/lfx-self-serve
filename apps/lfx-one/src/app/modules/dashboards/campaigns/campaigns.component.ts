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

/**
 * No brief in flight, and nothing to say about one.
 *
 * Shared by the pre-handoff state and the flag-off response on purpose: both mean "render no
 * persistence UI at all". A disabled cutover is the default in every environment, so it must
 * look exactly like the ordinary case rather than like a degraded one.
 */
const IDLE_PERSISTENCE: CampaignBriefPersistenceState = { status: 'off', briefId: null, message: null };

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

  protected readonly selectedTab = signal<CampaignTab>('planning');
  protected readonly selectedProgramType = signal<CampaignProgramType>('events');
  protected readonly selectedDeliveryType = signal<CampaignDeliveryType>('paid-marketing');
  protected readonly briefOutput = signal<CampaignBriefOutput | null>(null);
  protected readonly briefPersistence = signal<CampaignBriefPersistenceState>(IDLE_PERSISTENCE);

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
        this.briefPersistenceGeneration++;
        this.briefPersistence.set(IDLE_PERSISTENCE);
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
    // Read now, not when the chain reaches this link: the foundation selected when the user hit
    // Proceed is the one the brief belongs to. A switch while the save is queued bumps the
    // generation and discards the outcome anyway.
    const projectSlug = this.projectContextService.activeContext()?.slug ?? '';

    // Only once persistence is KNOWN to be on. The flag lives on the server, so the first save
    // of a session cannot know its state until the response arrives — and showing "Saving this
    // brief…" in the meantime would put a persistence banner in front of every user in every
    // environment where the cutover is still dark, which is all of them by default. The cost is
    // that the first save shows no in-flight banner, only its outcome; every later one in the
    // same session shows both.
    if (this.briefPersistenceEnabled()) {
      this.briefPersistence.set({ status: 'saving', briefId: null, message: null });
    }

    this.persistChain = this.persistChain.then(() =>
      firstValueFrom(this.campaignService.persistBrief(brief, projectSlug)).then(
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

          if (generation !== this.briefPersistenceGeneration) return;
          this.briefPersistence.set(result.enabled ? { status: 'saved', briefId: result.briefId, message: null } : IDLE_PERSISTENCE);
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
      )
    );
  }

  private resetToPlanning(): void {
    // Before clearing, so an in-flight save for the brief being discarded cannot write its
    // outcome back over the reset state.
    this.briefPersistenceGeneration++;
    this.briefOutput.set(null);
    this.briefPersistence.set(IDLE_PERSISTENCE);
    this.selectedTab.set('planning');
  }
}
