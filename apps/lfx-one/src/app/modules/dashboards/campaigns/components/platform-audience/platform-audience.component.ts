// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { PLATFORM_AUDIENCE_DEFAULT_WINDOWS, PLATFORM_AUDIENCE_NOT_MEASURED_LABEL, PLATFORM_AUDIENCE_WINDOW_OPTIONS } from '@lfx-one/shared/constants';
import type {
  CampaignServicePlatformAudienceMap,
  PlatformAudienceErrorKind,
  PlatformAudiencePanelPlatform,
  PlatformAudienceView,
  PlatformAudienceWindowOption,
} from '@lfx-one/shared/interfaces';
import { toPlatformAudienceView } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { CampaignService } from '@services/campaign.service';
import { platformAudienceErrorKind, platformAudienceErrorMessage } from '@shared/utils/campaign-audience-error.utils';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

/**
 * One ad platform's audience breakdowns for the project's own campaigns, read live from
 * campaign-service (`GET /api/campaigns/{platform}/audience`).
 *
 * The Google audience card's sibling, with what the source forces:
 *
 * - It takes the platform's own reporting WINDOW, offering only the windows that read accepts.
 * - A counter the platform did not measure is shown as "Not measured", never as `0`
 *   (`toPlatformAudienceView`); a Microsoft read with no finished report is "building", never "no
 *   audience"; LinkedIn's counters are estimates and say so.
 * - A failure is stated by cause (no connection, campaigns can't be read together, not confirmed, not enabled),
 *   decided on the BFF's code, with the platform's name in the sentence.
 */
@Component({
  selector: 'lfx-platform-audience',
  imports: [ButtonComponent, DatePipe, DecimalPipe, PercentPipe],
  templateUrl: './platform-audience.component.html',
  styleUrl: './platform-audience.component.scss',
})
export class PlatformAudienceComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly platform = input.required<PlatformAudiencePanelPlatform>();
  /** The platform's display name, used in every sentence the panel writes. */
  public readonly label = input.required<string>();
  public readonly projectSlug = input.required<string>();

  /** The window the operator picked, or `null` for the platform's own default. */
  protected readonly pickedWindow = signal<string | null>(null);
  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly errorKind = signal<PlatformAudienceErrorKind | null>(null);
  /** Bumped by Refresh and Retry. */
  protected readonly reloadToken = signal(0);
  protected readonly data = signal<CampaignServicePlatformAudienceMap[PlatformAudiencePanelPlatform] | null>(null);

  protected readonly notMeasuredLabel = PLATFORM_AUDIENCE_NOT_MEASURED_LABEL;

  protected readonly windowOptions: Signal<readonly PlatformAudienceWindowOption[]> = computed(() => PLATFORM_AUDIENCE_WINDOW_OPTIONS[this.platform()]);
  protected readonly selectedWindow: Signal<string> = computed(() => this.pickedWindow() ?? PLATFORM_AUDIENCE_DEFAULT_WINDOWS[this.platform()]);
  protected readonly view: Signal<PlatformAudienceView | null> = this.initView();
  protected readonly errorMessage: Signal<string> = computed(() => {
    const kind = this.errorKind();
    return kind === null ? '' : platformAudienceErrorMessage(kind, this.label());
  });
  /** Retrying cannot help a read the environment has switched off. */
  protected readonly canRetry: Signal<boolean> = computed(() => this.errorKind() !== 'not-enabled');
  /** The spend column's unit: the read's currency, or the ad account's own when the read does not say. */
  protected readonly spendUnit: Signal<string> = computed(() => this.view()?.currency ?? 'acct. currency');

  public constructor() {
    this.initLoad();
  }

  protected selectWindow(window: string): void {
    this.pickedWindow.set(window);
  }

  protected reload(): void {
    this.reloadToken.update((n) => n + 1);
  }

  /**
   * One read per (project, platform, window, reload). `switchMap`, so a read for an abandoned
   * window is cancelled rather than landing over the new one; errors are caught inside the switch
   * so one failed read does not end the stream.
   */
  private initLoad(): void {
    toObservable(computed(() => ({ projectSlug: this.projectSlug(), platform: this.platform(), window: this.selectedWindow(), reload: this.reloadToken() })))
      .pipe(
        switchMap(({ projectSlug, platform, window }) => {
          this.data.set(null);
          this.errorKind.set(null);
          if (projectSlug === '') {
            this.state.set('idle');
            return EMPTY;
          }
          this.state.set('loading');
          return this.campaignService.getPlatformAudience(projectSlug, platform, window).pipe(
            map((data) => ({
              data: data as CampaignServicePlatformAudienceMap[PlatformAudiencePanelPlatform] | null,
              kind: null as PlatformAudienceErrorKind | null,
            })),
            catchError((err: unknown) => of({ data: null, kind: platformAudienceErrorKind(err) }))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ data, kind }) => {
        this.data.set(data);
        this.errorKind.set(kind);
        this.state.set(data !== null ? 'loaded' : 'error');
      });
  }

  private initView(): Signal<PlatformAudienceView | null> {
    return computed(() => {
      const data = this.data();
      return data === null ? null : toPlatformAudienceView(this.platform(), data);
    });
  }
}
