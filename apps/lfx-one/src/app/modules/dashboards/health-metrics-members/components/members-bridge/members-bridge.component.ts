// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HEALTH_METRICS_MEMBERS_BRIDGE_FOOTER, HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED } from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersBridgeView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersMovementsDrawerComponent } from '../members-movements-drawer/members-movements-drawer.component';

import type {
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeBarView,
  HealthMetricsMembersBridgeQuery,
  HealthMetricsMembersBridgeView,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersSectionKey,
} from '@lfx-one/shared/interfaces';

/**
 * The membership bridge under `#tiers`: start → new → upgrades → downgrades → churned → end for the
 * selected year. One read carries every year, so a period change re-projects without re-reading.
 */
@Component({
  selector: 'lfx-members-bridge',
  imports: [EmptyStateComponent, MembersMovementsDrawerComponent, Skeleton],
  templateUrl: './members-bridge.component.html',
})
export class MembersBridgeComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the bridge settles — this section's height changes, moving every anchor below. */
  public readonly settled = output<void>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();
  /** The churn bar hands off to `#churn` rather than opening a list. */
  public readonly sectionPicked = output<HealthMetricsMembersSectionKey>();

  protected readonly footer = HEALTH_METRICS_MEMBERS_BRIDGE_FOOTER;
  protected readonly loading = signal<boolean>(true);
  protected readonly loadFailed = signal<boolean>(false);
  protected readonly drawerVisible = signal<boolean>(false);
  protected readonly drawerListType = signal<HealthMetricsMembersMovementListType | null>(null);
  protected readonly drawerBarCount = signal<number | null>(null);

  protected readonly query: Signal<HealthMetricsMembersBridgeQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsMembersBridge> = this.initResponse();
  protected readonly view: Signal<HealthMetricsMembersBridgeView> = computed(() =>
    buildHealthMetricsMembersBridgeView(this.response(), this.chrome.selectedRange())
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // The bridge is per year, so a pill change re-settles off the loaded response.
      toObservable(this.chrome.selectedRange)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe(() => this.onRangeChange());
    }
  }

  protected onBarPicked(bar: HealthMetricsMembersBridgeBarView): void {
    if (bar.opensChurn) {
      this.sectionPicked.emit('churn');
      return;
    }
    if (!bar.listType) return;

    this.drawerListType.set(bar.listType);
    this.drawerBarCount.set(bar.memberCount);
    this.drawerVisible.set(true);
  }

  private initResponse(): Signal<HealthMetricsMembersBridge> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.drawerVisible.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug ? this.analyticsService.getMembersBridge(query) : of(HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED)).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED);
            }),
            tap(() => {
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit();
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_MEMBERS_BRIDGE_UNMEASURED }
    );
  }

  /** Re-settles the re-projected bridge; a read in flight or failed settles on its own. */
  private onRangeChange(): void {
    this.drawerVisible.set(false);
    if (this.loadFailed() || this.loading()) return;

    this.settled.emit();
  }
}
