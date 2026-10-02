// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import {
  HEALTH_METRICS_TRAINING_DATA_SECTIONS,
  HEALTH_METRICS_TRAINING_NO_PROGRAMME,
  HEALTH_METRICS_TRAINING_SCOPE_NOTE,
  HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX,
  HEALTH_METRICS_TRAINING_SECTIONS,
  HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingSubNavItems } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';

import type { HealthMetricsTrainingPresenceState, HealthMetricsTrainingSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Training (Level 2) — two anchored sections in the shared Level 2 shell, or a single empty card
 * when the foundation runs no training. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-training',
  imports: [EmptyStateComponent, HealthMetricsL2ShellComponent, Skeleton],
  templateUrl: './health-metrics-training.component.html',
})
export class HealthMetricsTrainingComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly sections = HEALTH_METRICS_TRAINING_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_TRAINING_DATA_SECTIONS;
  protected readonly crossReference = HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE;
  protected readonly scopeNote = HEALTH_METRICS_TRAINING_SCOPE_NOTE;
  protected readonly noProgramme = HEALTH_METRICS_TRAINING_NO_PROGRAMME;
  protected readonly subNavItems: HealthMetricsTrainingSubNavItem[] = buildHealthMetricsTrainingSubNavItems();

  private readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  protected readonly state: Signal<HealthMetricsTrainingPresenceState> = this.initState();

  private initState(): Signal<HealthMetricsTrainingPresenceState> {
    if (!isPlatformBrowser(this.platformId)) {
      // Stays on the skeleton so the serialized page matches the pre-hydration DOM.
      return computed(() => 'loading');
    }

    return toSignal(
      toObservable(this.foundationSlug).pipe(
        distinctUntilChanged(),
        // An unresolved foundation holds the skeleton; switchMap cancels a read the foundation outran.
        switchMap((foundationSlug) =>
          foundationSlug
            ? this.analyticsService.getTrainingPresence({ foundationSlug }).pipe(
                map((presence): HealthMetricsTrainingPresenceState => (presence.hasProgramme ? 'present' : 'absent')),
                // `AnalyticsService` has already logged the error before rethrowing it.
                catchError(() => of<HealthMetricsTrainingPresenceState>('failed')),
                startWith<HealthMetricsTrainingPresenceState>('loading')
              )
            : of<HealthMetricsTrainingPresenceState>('loading')
        )
      ),
      { initialValue: 'loading' }
    );
  }
}
