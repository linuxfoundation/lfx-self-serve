// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  makeStateKey,
  PLATFORM_ID,
  REQUEST,
  REQUEST_CONTEXT,
  signal,
  Signal,
  TransferState,
  untracked,
  WritableSignal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MEETINGS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { MeetingPageRedesignDecision, ServerRequestContext } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { mirrorOverridesToCookie, readCookieOverride } from '@shared/guards/meeting-page-redesign.guard';

import { MeetingsDashboardComponent } from '../meetings-dashboard/meetings-dashboard.component';
import { MeetingsRedesignComponent } from '../meetings-redesign/meetings-redesign.component';

/** The page the server chose for a `/project/meetings` or `/foundation/meetings` render; read once by the browser. */
export const MEETINGS_LIST_REDESIGN_KEY = makeStateKey<MeetingPageRedesignDecision>('meetingsListRedesign');

/**
 * Route entry for the meetings lists: the existing dashboard, or the `@defer`-loaded redesign behind the flag.
 * @description The flat `/meetings` shows the redesign in the Me lens only and decides in the browser. `/project/meetings` and
 * `/foundation/meetings` decide on the server from `ServerRequestContext.flags` and hand that over in TransferState, so with the
 * flag off the dashboard still renders on the server. A plain `@defer` block renders nothing on the server.
 */
@Component({
  selector: 'lfx-meetings-entry',
  templateUrl: './meetings-entry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, MeetingsDashboardComponent, MeetingsRedesignComponent],
  host: { class: 'block' },
})
export class MeetingsEntryComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly requestContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  private readonly path: string = this.route.snapshot.pathFromRoot.flatMap((s) => s.url.map((u) => u.path)).join('/');
  private readonly isFlatMeetingsUrl: boolean = this.path === 'meetings';
  /** The list pages the redesign covers: the Me lens list and the project and foundation lists. */
  private readonly isListUrl: boolean = this.isFlatMeetingsUrl || this.path === 'project/meetings' || this.path === 'foundation/meetings';
  /** `null` until resolved (always on the server). Other URLs start at `false`, so they render the dashboard at once. Fixed once resolved. */
  private readonly showRedesign: WritableSignal<boolean | null> = signal(this.isListUrl ? null : false);

  protected readonly view: Signal<'loading' | 'v1' | 'redesign'> = this.initView();

  public constructor() {
    if (!this.isListUrl) return;
    const browser = isPlatformBrowser(this.platformId);
    if (!this.isFlatMeetingsUrl) {
      if (!browser) {
        this.resolve(readCookieOverride(this.request) ?? this.requestContext?.flags?.meetingsRedesign ?? false);
        this.transferState.set(MEETINGS_LIST_REDESIGN_KEY, { id: this.path, enabled: this.showRedesign() === true });
        return;
      }
      mirrorOverridesToCookie();
      const decided = this.transferState.get(MEETINGS_LIST_REDESIGN_KEY, null);
      this.transferState.remove(MEETINGS_LIST_REDESIGN_KEY);
      if (decided?.id === this.path) {
        this.showRedesign.set(decided.enabled);
        return;
      }
    }
    // LaunchDarkly is browser-only: on the server the flat URL stays on the loading state.
    if (browser) afterNextRender(() => void this.resolveFlag());
  }

  private initView(): Signal<'loading' | 'v1' | 'redesign'> {
    return computed(() => {
      const showRedesign = this.showRedesign();
      if (showRedesign === null) return 'loading';
      return showRedesign ? 'redesign' : 'v1';
    });
  }

  private async resolveFlag(): Promise<void> {
    const override = this.featureFlagService.getFlagOverride(MEETINGS_REDESIGN_FLAG);
    if (override !== undefined) {
      this.resolve(override);
      return;
    }

    if (!this.featureFlagService.providerReady()) {
      const ready = await this.featureFlagService.waitForReady({ guard: 'MeetingsEntryComponent', flag: MEETINGS_REDESIGN_FLAG });
      if (!ready) {
        this.resolve(false);
        return;
      }
    }

    this.resolve(this.featureFlagService.getBooleanFlag(MEETINGS_REDESIGN_FLAG, false)());
  }

  private resolve(flagOn: boolean): void {
    // Read the lens once, untracked: a later lens change must not swap the page. The flat URL is the Me lens list only.
    this.showRedesign.set(flagOn && (!this.isFlatMeetingsUrl || untracked(() => this.lensService.activeLens()) === 'me'));
  }
}
