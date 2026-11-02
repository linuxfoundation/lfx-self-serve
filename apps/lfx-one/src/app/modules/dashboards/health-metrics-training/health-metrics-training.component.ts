// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  HEALTH_METRICS_TRAINING_BLANK,
  HEALTH_METRICS_TRAINING_DATA_SECTIONS,
  HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX,
  HEALTH_METRICS_TRAINING_SECTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsTrainingSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { TrainingCoursesComponent } from './components/training-courses/training-courses.component';
import { TrainingEnrollComponent } from './components/training-enroll/training-enroll.component';

import type { HealthMetricsTrainingSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Training (Level 2) — two anchored sections in the shared Level 2 shell, which swaps them for one blank card
 * when neither has anything for the period. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-training',
  imports: [HealthMetricsL2SectionDirective, HealthMetricsL2ShellComponent, TrainingCoursesComponent, TrainingEnrollComponent],
  templateUrl: './health-metrics-training.component.html',
})
export class HealthMetricsTrainingComponent {
  protected readonly sections = HEALTH_METRICS_TRAINING_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_TRAINING_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_TRAINING_BLANK;
  /** Courses ever enrolled in, for the sub-nav badge; `null` until the section reports one. */
  protected readonly coursesCount = signal<number | null>(null);
  protected readonly subNavItems = computed<HealthMetricsTrainingSubNavItem[]>(() => buildHealthMetricsTrainingSubNavItems({ courses: this.coursesCount() }));
}
