// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_PROGRAM_DETAIL_COMING_SOON } from '@lfx-one/shared/constants';
import { MentorshipProgramDetail, MentorshipProgramDetailTab } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { filter, map, switchMap, tap } from 'rxjs';

import { ApplicantsTabComponent } from './components/applicants-tab/applicants-tab.component';
import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { PastMenteesTabComponent } from './components/past-mentees-tab/past-mentees-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';

/**
 * Admin program-detail page. Loads a program by id (default) or slug and hosts
 * the four underline tabs (mentees, applicants, mentors, terms). The mentees tab
 * shows current mentees for a live program and past mentees once it is completed.
 */
@Component({
  selector: 'lfx-mentorship-program-detail',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    ProgramDetailHeaderComponent,
    CurrentMenteesTabComponent,
    PastMenteesTabComponent,
    ApplicantsTabComponent,
    MentorsTabComponent,
    TermsTabComponent,
  ],
  templateUrl: './program-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgramDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);

  protected readonly isLoading = signal(true);
  protected readonly activeTab = signal<MentorshipProgramDetailTab>('mentees');

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly detail: Signal<MentorshipProgramDetail | null> = this.initDetail();
  protected readonly terms = computed(() => this.detail()?.terms ?? []);
  protected readonly mentees = computed(() => this.detail()?.mentees ?? []);
  protected readonly applicants = computed(() => this.detail()?.applicants ?? []);
  protected readonly mentors = computed(() => this.detail()?.mentors ?? []);
  protected readonly tabCounts = computed(() => this.detail()?.tabCounts ?? { mentees: 0, applicants: 0, mentors: 0, terms: 0 });

  /** A completed program has no enrolled mentees, so the first tab shows past ones. */
  protected readonly isCompleted = computed(() => this.detail()?.program.status === 'completed');

  protected onTabChange(tab: MentorshipProgramDetailTab): void {
    this.activeTab.set(tab);
  }

  protected onEditProgram(): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Edit program',
      detail: MENTORSHIP_PROGRAM_DETAIL_COMING_SOON,
      life: 4000,
    });
  }

  private initDetail(): Signal<MentorshipProgramDetail | null> {
    return toSignal(
      toObservable(this.programId).pipe(
        filter((programId) => !!programId),
        tap(() => this.isLoading.set(true)),
        switchMap((programId) => this.mentorshipService.getProgram(programId).pipe(tap(() => this.isLoading.set(false))))
      ),
      { initialValue: null }
    );
  }
}
