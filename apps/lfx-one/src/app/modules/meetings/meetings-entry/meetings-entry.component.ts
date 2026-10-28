// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
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
 * first render so hydration matches. Both pages are `@defer`-loaded so the unchosen one never downloads.
 */
@Component({
  selector: 'lfx-meetings-entry',
  templateUrl: './meetings-entry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Referenced only from `@defer` blocks, so the bundler splits them out.
  imports: [MeetingsDashboardComponent, MeetingsRedesignComponent],
})
export class MeetingsEntryComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  /** `null` until the flag is resolved (always on the server). Fixed once resolved, so the page never swaps under the user. */
  private readonly flagOn: WritableSignal<boolean | null> = signal(null);
  private readonly isFlatMeetingsUrl: boolean = this.route.snapshot.pathFromRoot.flatMap((s) => s.url.map((u) => u.path)).join('/') === 'meetings';

  protected readonly view: Signal<'loading' | 'v1' | 'redesign'> = computed(() => {
    const flagOn = this.flagOn();
    if (flagOn === null) return 'loading';
    return flagOn && this.isFlatMeetingsUrl && this.lensService.activeLens() === 'me' ? 'redesign' : 'v1';
  });

  public constructor() {
    // LaunchDarkly is browser-only: on the server the view stays on the loading state.
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => void this.resolveFlag());
    }
  }

  private async resolveFlag(): Promise<void> {
    const override = this.featureFlagService.getFlagOverride(MEETINGS_REDESIGN_FLAG);
    if (override !== undefined) {
      this.flagOn.set(override);
      return;
    }

    if (!this.featureFlagService.providerReady()) {
      const ready = await this.featureFlagService.waitForReady(
        { guard: 'MeetingsEntryComponent', flag: MEETINGS_REDESIGN_FLAG },
        MEETINGS_REDESIGN_READY_TIMEOUT_MS
      );
      if (!ready) {
        this.flagOn.set(false);
        return;
      }
    }

    this.flagOn.set(this.featureFlagService.getBooleanFlag(MEETINGS_REDESIGN_FLAG, false)());
  }
}
