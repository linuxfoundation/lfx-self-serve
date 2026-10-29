// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal, Signal, untracked, WritableSignal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MEETINGS_REDESIGN_FLAG, MEETINGS_REDESIGN_READY_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';

import { MeetingsDashboardComponent } from '../meetings-dashboard/meetings-dashboard.component';
import { MeetingsRedesignComponent } from '../meetings-redesign/meetings-redesign.component';

/**
 * Route entry for `/meetings`: the existing dashboard, or the `@defer`-loaded redesign (flag on, Me lens, flat URL).
 * A plain `@defer` block (no hydrate trigger) renders nothing on the server, so the dashboard is rendered directly.
 */
@Component({
  selector: 'lfx-meetings-entry',
  templateUrl: './meetings-entry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MeetingsDashboardComponent, MeetingsRedesignComponent],
  host: { class: 'block' },
})
export class MeetingsEntryComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly isFlatMeetingsUrl: boolean = this.route.snapshot.pathFromRoot.flatMap((s) => s.url.map((u) => u.path)).join('/') === 'meetings';
  /** `null` until resolved (always on the server). Non-flat URLs start at `false`, so they render the dashboard at once. Fixed once resolved. */
  private readonly showRedesign: WritableSignal<boolean | null> = signal(this.isFlatMeetingsUrl ? null : false);

  protected readonly view: Signal<'loading' | 'v1' | 'redesign'> = this.initView();

  public constructor() {
    // LaunchDarkly is browser-only: on the server the flat URL stays on the loading state.
    if (this.isFlatMeetingsUrl && isPlatformBrowser(this.platformId)) {
      afterNextRender(() => void this.resolveFlag());
    }
  }

  private async resolveFlag(): Promise<void> {
    const override = this.featureFlagService.getFlagOverride(MEETINGS_REDESIGN_FLAG);
    if (override !== undefined) {
      this.resolve(override);
      return;
    }

    if (!this.featureFlagService.providerReady()) {
      const ready = await this.featureFlagService.waitForReady(
        { guard: 'MeetingsEntryComponent', flag: MEETINGS_REDESIGN_FLAG },
        MEETINGS_REDESIGN_READY_TIMEOUT_MS
      );
      if (!ready) {
        this.resolve(false);
        return;
      }
    }

    this.resolve(this.featureFlagService.getBooleanFlag(MEETINGS_REDESIGN_FLAG, false)());
  }

  private resolve(flagOn: boolean): void {
    // Read the lens once, untracked: a later lens change must not swap the page.
    this.showRedesign.set(flagOn && untracked(() => this.lensService.activeLens()) === 'me');
  }

  private initView(): Signal<'loading' | 'v1' | 'redesign'> {
    return computed(() => {
      const showRedesign = this.showRedesign();
      if (showRedesign === null) return 'loading';
      return showRedesign ? 'redesign' : 'v1';
    });
  }
}
