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
 * Route entry for the meetings page: picks the existing dashboard or the redesigned page.
 * @description The same routes mount at `/meetings`, `/foundation/meetings` and `/project/meetings`; only the
 * flat Me lens `/meetings` can show the redesign, and only while `MEETINGS_REDESIGN_FLAG` is on. The server
 * always renders the loading state (LaunchDarkly is browser-only), and the browser resolves it after the
 * first render so hydration matches. The flag and the active lens are read once, together, so the page
 * never swaps under the user afterwards. Both pages are `@defer`-loaded, and the existing dashboard's chunk
 * is prefetched while the flag resolves so its users pay no extra latency.
 */
@Component({
  selector: 'lfx-meetings-entry',
  templateUrl: './meetings-entry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Referenced only from `@defer` blocks, so the bundler splits them out.
  imports: [MeetingsDashboardComponent, MeetingsRedesignComponent],
  host: { class: 'block' },
})
export class MeetingsEntryComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  /** `null` until resolved (always on the server). Fixed once resolved, so the page never swaps under the user. */
  private readonly showRedesign: WritableSignal<boolean | null> = signal(null);
  private readonly isFlatMeetingsUrl: boolean = this.route.snapshot.pathFromRoot.flatMap((s) => s.url.map((u) => u.path)).join('/') === 'meetings';

  protected readonly view: Signal<'loading' | 'v1' | 'redesign'> = this.initView();

  public constructor() {
    // LaunchDarkly is browser-only: on the server the view stays on the loading state.
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => void this.resolveFlag());
    }
  }

  private async resolveFlag(): Promise<void> {
    // /foundation/meetings and /project/meetings never show the redesign: skip every LaunchDarkly wait.
    if (!this.isFlatMeetingsUrl) {
      this.showRedesign.set(false);
      return;
    }

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
