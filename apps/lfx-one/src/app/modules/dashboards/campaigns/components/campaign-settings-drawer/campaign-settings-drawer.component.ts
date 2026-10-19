// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { CAMPAIGN_PLATFORMS, CAMPAIGN_SETTINGS_UNKNOWN_COUNT_NOTE } from '@lfx-one/shared/constants';
import type { CampaignIndexDoc, CampaignSettingsDrawerState } from '@lfx-one/shared/interfaces';
import { buildCampaignSettingsDrift } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { campaignSettingsReadErrorMessage } from '@shared/utils/campaign-optimize-error.utils';
import { DrawerModule } from 'primeng/drawer';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The live-settings drift drawer for one Optimize-tab campaign row (lfx-self-serve#3299).
 *
 * Compares what the campaign row RECORDED (what LFX One asked the platform for) with what the
 * platform holds now, through campaign-service's settings readback. A pure read: nothing is written
 * to the platform or the row, and nothing is cached — every opening reads the platform again.
 *
 * `unknown` is shown as "Not compared" with the reason, never as a match, and a side the platform
 * did not report reads "Not reported" rather than a blank or a zero. LinkedIn's bid is shown with
 * its currency (`buildCampaignSettingsDrift`).
 */
@Component({
  selector: 'lfx-campaign-settings-drawer',
  imports: [ButtonComponent, DatePipe, DrawerModule, TagComponent],
  templateUrl: './campaign-settings-drawer.component.html',
  styleUrl: './campaign-settings-drawer.component.scss',
})
export class CampaignSettingsDrawerComponent {
  private readonly campaignService = inject(CampaignService);

  /** The campaign whose settings are read; the drawer reads nothing while it is `null`. */
  public readonly campaign = input<CampaignIndexDoc | null>(null);
  public readonly projectSlug = input('');
  public readonly briefId = input('');

  public readonly visible = model(false);

  /** Bumped by Retry: re-runs the read for the same campaign. */
  private readonly reload = signal(0);

  protected readonly unknownCountNote = CAMPAIGN_SETTINGS_UNKNOWN_COUNT_NOTE;
  protected readonly state: Signal<CampaignSettingsDrawerState> = this.initState();
  protected readonly platformLabel: Signal<string> = this.initPlatformLabel();

  protected retry(): void {
    this.reload.update((n) => n + 1);
  }

  /**
   * One read per (opening, campaign, retry). `switchMap` drops a read the operator has moved past —
   * closing the drawer or opening another campaign — so a slow answer cannot paint over the current one.
   */
  private initState(): Signal<CampaignSettingsDrawerState> {
    const idle: CampaignSettingsDrawerState = { status: 'idle', drift: null, message: '' };
    const request = computed(() => ({
      open: this.visible(),
      campaign: this.campaign(),
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      attempt: this.reload(),
    }));
    return toSignal(
      toObservable(request).pipe(
        switchMap(({ open, campaign, projectSlug, briefId }) => {
          if (!open || !campaign) {
            return of(idle);
          }
          return this.campaignService.getCampaignSettings(projectSlug, briefId, campaign.id).pipe(
            map((readback): CampaignSettingsDrawerState => ({ status: 'ready', drift: buildCampaignSettingsDrift(readback), message: '' })),
            catchError((error: unknown) => of<CampaignSettingsDrawerState>({ status: 'error', drift: null, message: campaignSettingsReadErrorMessage(error) })),
            startWith<CampaignSettingsDrawerState>({ status: 'loading', drift: null, message: '' })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  private initPlatformLabel(): Signal<string> {
    return computed(() => {
      const platform = this.campaign()?.platform;
      return CAMPAIGN_PLATFORMS.find((p) => p.id === platform)?.label ?? 'the ad platform';
    });
  }
}
