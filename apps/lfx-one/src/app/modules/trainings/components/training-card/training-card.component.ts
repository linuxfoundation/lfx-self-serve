// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { Certification, EnrollmentStatus, TrainingEnrollment } from '@lfx-one/shared/interfaces';
import { CONTINUE_LEARNING_URL, COURSE_URL_PREFIX, ENROLL_AGAIN_URL, ENROLL_AGAIN_URL_PREFIX } from '@lfx-one/shared/constants';
import { formatDuration } from '@lfx-one/shared/utils';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-training-card',
  imports: [ButtonComponent, CardComponent, DatePipe, NgClass],
  templateUrl: './training-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingCardComponent {
  // ─── Inputs ────────────────────────────────────────────────────────────────
  public readonly training = input.required<TrainingEnrollment | Certification>();
  public readonly variant = input<'ongoing' | 'completed'>('ongoing');
  public readonly showStatus = input<boolean>(true);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly hasImage = computed(() => !!this.training().imageUrl);
  protected readonly isOngoing = computed(() => this.variant() === 'ongoing');
  protected readonly levelClasses: Signal<string> = this.initLevelClasses();
  protected readonly downloadUrl: Signal<string | null> = this.initDownloadUrl();
  protected readonly continueLearningUrl: Signal<string> = this.initContinueLearningUrl();
  protected readonly enrollAgainUrl: Signal<string> = this.initEnrollAgainUrl();
  protected readonly isActiveEnrollment: Signal<boolean> = this.initIsActiveEnrollment();
  protected readonly statusLabel: Signal<string> = this.initStatusLabel();
  protected readonly statusClasses: Signal<string> = this.initStatusClasses();
  protected readonly enrolledDate: Signal<string | null> = this.initEnrolledDate();
  protected readonly timeSpent: Signal<string | null> = this.initTimeSpent();
  protected readonly completedIssuedDate: Signal<string | null> = this.initCompletedIssuedDate();

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initLevelClasses(): Signal<string> {
    return computed(() => {
      const level = this.training().level;
      if (level === 'Beginner') return 'bg-blue-50 text-blue-700 border border-blue-200';
      if (level === 'Intermediate') return 'bg-purple-50 text-purple-700 border border-purple-200';
      if (level === 'Advanced') return 'bg-orange-50 text-orange-700 border border-orange-200';
      return 'bg-gray-50 text-gray-500 border border-gray-200';
    });
  }

  private initDownloadUrl(): Signal<string | null> {
    return computed(() => {
      if (this.variant() !== 'completed') return null;
      const t = this.training() as Certification;
      return t.downloadUrl ?? null;
    });
  }

  private initContinueLearningUrl(): Signal<string> {
    return computed(() => {
      const t = this.training() as TrainingEnrollment;
      return t.courseSlug ? `${COURSE_URL_PREFIX}${t.courseSlug}` : CONTINUE_LEARNING_URL;
    });
  }

  private initEnrollAgainUrl(): Signal<string> {
    return computed(() => {
      const t = this.training() as TrainingEnrollment;
      return t.courseSlug ? `${ENROLL_AGAIN_URL_PREFIX}${t.courseSlug}` : ENROLL_AGAIN_URL;
    });
  }

  private initIsActiveEnrollment(): Signal<boolean> {
    return computed(() => {
      if (this.variant() !== 'ongoing') return true;
      const t = this.training() as TrainingEnrollment;
      return t.isActiveEnrollment;
    });
  }

  private initStatusLabel(): Signal<string> {
    return computed(() => {
      if (this.variant() !== 'ongoing') return '';
      const status = (this.training() as TrainingEnrollment).status as EnrollmentStatus | null;
      const labels: Record<EnrollmentStatus, string> = {
        started: 'Started',
        completed: 'Completed',
        'not-started': 'Not Started',
        'not-completed': 'Not Completed',
      };
      return status ? (labels[status] ?? '') : '';
    });
  }

  private initEnrolledDate(): Signal<string | null> {
    return computed(() => {
      if (this.variant() !== 'ongoing') return null;
      return (this.training() as TrainingEnrollment).enrolledDate ?? null;
    });
  }

  private initTimeSpent(): Signal<string | null> {
    return computed(() => {
      if (this.variant() !== 'ongoing') return null;
      const seconds = (this.training() as TrainingEnrollment).totalTime;
      return seconds != null ? formatDuration(seconds) : null;
    });
  }

  private initCompletedIssuedDate(): Signal<string | null> {
    return computed(() => {
      if (this.variant() !== 'completed') return null;
      return (this.training() as Certification).issuedDate ?? null;
    });
  }

  private initStatusClasses(): Signal<string> {
    return computed(() => {
      if (this.variant() !== 'ongoing') return '';
      const status = (this.training() as TrainingEnrollment).status as EnrollmentStatus | null;
      const classes: Record<EnrollmentStatus, string> = {
        started: 'bg-blue-50 text-blue-700 border border-blue-200',
        completed: 'bg-green-50 text-green-700 border border-green-200',
        'not-started': 'bg-gray-50 text-gray-500 border border-gray-200',
        'not-completed': 'bg-red-50 text-red-600 border border-red-200',
      };
      return status ? (classes[status] ?? 'bg-gray-50 text-gray-500 border border-gray-200') : '';
    });
  }
}
