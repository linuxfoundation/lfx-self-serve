// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_TRAINING_BLANK,
  HEALTH_METRICS_TRAINING_COURSES_TYPE_OPTIONS,
  HEALTH_METRICS_TRAINING_DATA_SECTIONS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS,
  HEALTH_METRICS_TRAINING_QUERY_PARAMS,
  HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX,
  HEALTH_METRICS_TRAINING_SECTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingSubNavItems, parseHealthMetricsTrainingCoursesType } from '@lfx-one/shared/utils';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';

import { HealthMetricsL2SectionControlsDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section-controls.directive';
import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { TrainingCoursesComponent } from './components/training-courses/training-courses.component';
import { TrainingEnrollComponent } from './components/training-enroll/training-enroll.component';

import type { HealthMetricsTrainingCoursesType, HealthMetricsTrainingEnrollmentMetric, HealthMetricsTrainingSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Training (Level 2) — two anchored sections in the shared Level 2 shell, which swaps them for one blank card
 * when neither has anything for the period. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-training',
  imports: [
    HealthMetricsL2SectionControlsDirective,
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
    TrainingCoursesComponent,
    TrainingEnrollComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './health-metrics-training.component.html',
})
export class HealthMetricsTrainingComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly sections = HEALTH_METRICS_TRAINING_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_TRAINING_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_TRAINING_BLANK;
  /** Courses reports its course count once read, for its sub-nav entry. */
  protected readonly coursesCount = signal<number | null>(null);
  protected readonly subNavItems = computed<HealthMetricsTrainingSubNavItem[]>(() => buildHealthMetricsTrainingSubNavItems(this.coursesCount()));
  protected readonly enrollMetrics = HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS;
  /** The header switch's measure: local to the page, not written to the URL, and Enrollments by default. */
  protected readonly enrollMetric = signal<HealthMetricsTrainingEnrollmentMetric>('enrollments');

  protected readonly coursesTypes = HEALTH_METRICS_TRAINING_COURSES_TYPE_OPTIONS;
  // The header select lives in the section's controls, so the page owns the cut; the section keeps it in the URL.
  protected readonly coursesType = signal<HealthMetricsTrainingCoursesType>(
    parseHealthMetricsTrainingCoursesType(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_TRAINING_QUERY_PARAMS.coursesType))
  );

  protected onCoursesTypeChange(value: string | null): void {
    this.coursesType.set(parseHealthMetricsTrainingCoursesType(value));
  }

  protected onEnrollMetricChange(value: string | null): void {
    const option = HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS.find((candidate) => candidate.id === value);
    if (option) this.enrollMetric.set(option.id);
  }
}
