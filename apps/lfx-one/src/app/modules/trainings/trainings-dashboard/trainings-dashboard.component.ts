// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Certification, FilterPillOption, TrainingEnrollment, UnifiedCertification } from '@lfx-one/shared/interfaces';
import { TRAINING_PRODUCT_TYPE } from '@lfx-one/shared/constants';

import { SkeletonModule } from 'primeng/skeleton';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TrainingService } from '@shared/services/training.service';
import { RewardsComponent } from '../components/rewards/rewards.component';
import { TrainingCardComponent } from '../components/training-card/training-card.component';
import { UnifiedCertCardComponent } from '../components/unified-cert-card/unified-cert-card.component';

const PAGE_SUBTITLE = 'Track your Linux Foundation learning journey — active certifications, enrolled courses, rewards, and resources all in one place.';

const TAB_OPTIONS: FilterPillOption[] = [
  { id: 'certifications', label: 'Certifications' },
  { id: 'enrolled-trainings', label: 'Enrolled Trainings' },
  { id: 'rewards', label: 'Rewards' },
];

const USEFUL_LINKS = [
  {
    label: 'LF Training Portal',
    url: 'https://trainingportal.linuxfoundation.org',
    description: 'Access your enrolled courses, track learning progress, and resume where you left off.',
  },
  {
    label: 'LF Education & Certification',
    url: 'https://training.linuxfoundation.org',
    description: 'Browse certifications, explore the full course catalog, and register for exams.',
  },
  {
    label: 'Certification Verification Tool',
    url: 'https://training.linuxfoundation.org/certification/verify/',
    description: 'Want proof of your certification? Use our Verification Tool to confirm and share the validity of your certifications.',
  },
];

@Component({
  selector: 'lfx-trainings-dashboard',
  imports: [ButtonComponent, CardComponent, FilterPillsComponent, RewardsComponent, SkeletonModule, TrainingCardComponent, UnifiedCertCardComponent],
  templateUrl: './trainings-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingsDashboardComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly trainingService = inject(TrainingService);

  // ─── Configuration ─────────────────────────────────────────────────────────
  protected readonly subtitle = PAGE_SUBTITLE;
  protected readonly tabOptions = TAB_OPTIONS;
  protected readonly usefulLinks = USEFUL_LINKS;

  // ─── Writable Signals ──────────────────────────────────────────────────────
  protected readonly activeTab = signal<string>('certifications');

  // ─── Data Signals ──────────────────────────────────────────────────────────
  protected readonly unifiedCerts: Signal<UnifiedCertification[] | undefined> = this.initUnifiedCerts();
  protected readonly enrollments: Signal<TrainingEnrollment[] | undefined> = this.initEnrollments();
  protected readonly completedTrainings: Signal<Certification[] | undefined> = this.initCompletedTrainings();

  // ─── Stat Card Signals ─────────────────────────────────────────────────────
  protected readonly trainingsStatsLoading = computed(
    () => this.unifiedCerts() === undefined || this.enrollments() === undefined || this.completedTrainings() === undefined
  );
  protected readonly activeEnrollments = computed(() => this.enrollments()?.filter((e) => e.isActiveEnrollment) ?? []);
  protected readonly expiredEnrollments = computed(() => this.enrollments()?.filter((e) => !e.isActiveEnrollment) ?? []);
  protected readonly enrolledCount = computed(() => this.enrollments()?.length ?? 0);
  protected readonly completedCount = computed(() => this.completedTrainings()?.length ?? 0);

  // ─── Certification Section Signals ────────────────────────────────────────
  protected readonly myCerts = computed(() => this.unifiedCerts()?.filter((c) => c.certId !== null) ?? []);
  protected readonly certificatesCount = computed(() => this.myCerts().length);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onTabChange(tabId: string): void {
    this.activeTab.set(tabId);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initUnifiedCerts(): Signal<UnifiedCertification[] | undefined> {
    return toSignal(this.trainingService.getUnifiedCertifications());
  }

  private initEnrollments(): Signal<TrainingEnrollment[] | undefined> {
    return toSignal(this.trainingService.getEnrollments());
  }

  private initCompletedTrainings(): Signal<Certification[] | undefined> {
    return toSignal(this.trainingService.getCertifications(TRAINING_PRODUCT_TYPE));
  }
}
