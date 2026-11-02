// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { INTERCOM_CUSTOM_LAUNCHER_ID } from '@lfx-one/shared/constants';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { IntercomService } from '@services/intercom.service';
import { OverlayStateService } from '@services/overlay-state.service';

// Compact support button that stands in for Intercom's default launcher on phone widths. Intercom
// binds to it through `custom_launcher_selector` (see IntercomService), and it steps aside while an
// overlay registered with OverlayStateService is open (today the meeting-join guests drawer) or a page
// reports a sticky bottom bar, so it never covers row actions. The account menu's
// Support row remains the always-available fallback.
@Component({
  selector: 'lfx-support-launcher',
  imports: [OpenIntercomDirective],
  templateUrl: './support-launcher.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportLauncherComponent {
  private readonly intercomService = inject(IntercomService);
  private readonly overlayState = inject(OverlayStateService);

  protected readonly launcherId = INTERCOM_CUSTOM_LAUNCHER_ID;
  protected readonly visible = computed(
    () => this.intercomService.customLauncherActive() && !this.overlayState.anyOpen() && !this.overlayState.stickyBarVisible()
  );

  public constructor() {
    // The button is rendered after Intercom's boot command was queued, so ask the widget to re-scan
    // for it. Browser-only: afterNextRender never runs during SSR.
    afterNextRender(() => this.intercomService.update());
  }
}
