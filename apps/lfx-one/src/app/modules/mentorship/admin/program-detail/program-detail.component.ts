// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MENTORSHIP_PROGRAM_DETAIL_COMING_SOON } from '@lfx-one/shared/constants';
import { MentorshipProgramDetail, MentorshipProgramDetailTab, MentorshipProgramPerson, MentorshipProgramTermRow } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { filter, map, switchMap, tap } from 'rxjs';

import { ApplicantsTabComponent } from './components/applicants-tab/applicants-tab.component';
import { CurrentMenteesTabComponent } from './components/current-mentees-tab/current-mentees-tab.component';
import { MentorsTabComponent } from './components/mentors-tab/mentors-tab.component';
import { ProgramDetailHeaderComponent } from './components/program-detail-header/program-detail-header.component';
import { TermsTabComponent } from './components/terms-tab/terms-tab.component';

/**
 * Admin program-detail page. Loads a program by id (default) or slug and hosts
 * the four underline tabs (mentees, applicants, mentors, terms).
 */
@Component({
  selector: 'lfx-mentorship-program-detail',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    ProgramDetailHeaderComponent,
    CurrentMenteesTabComponent,
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
  protected readonly termsOverride = signal<MentorshipProgramTermRow[] | null>(null);
  protected readonly applicantsOverride = signal<MentorshipProgramPerson[] | null>(null);

  protected readonly programId = toSignal(this.route.paramMap.pipe(map((params) => params.get('programId') ?? '')), { initialValue: '' });
  protected readonly detail: Signal<MentorshipProgramDetail | null> = this.initDetail();
  protected readonly terms = computed(() => this.termsOverride() ?? this.detail()?.terms ?? []);
  protected readonly applicants = computed(() => this.applicantsOverride() ?? this.detail()?.applicants ?? []);
  protected readonly tabCounts = computed(() => {
    const detail = this.detail();
    if (!detail) return { mentees: 0, applicants: 0, mentors: 0, terms: 0 };
    const override = this.termsOverride();
    if (!override) return detail.tabCounts;
    return { ...detail.tabCounts, terms: override.length };
  });

  protected onTermsChange(terms: MentorshipProgramTermRow[]): void {
    const closedTermNames = this.newlyClosedTermNames(this.terms(), terms);
    this.termsOverride.set(terms);

    if (closedTermNames.size === 0) return;

    // Closing a term declines its outstanding applications, so the Applicants tab
    // must not keep showing those people as pending.
    this.applicantsOverride.set(
      this.applicants().map((applicant): MentorshipProgramPerson => {
        const declined = applicant.status === 'pending' && closedTermNames.has(applicant.termName);
        return declined ? { ...applicant, status: 'declined' } : applicant;
      })
    );
  }

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

  private newlyClosedTermNames(previous: MentorshipProgramTermRow[], next: MentorshipProgramTermRow[]): Set<string> {
    const openTermIds = new Set(previous.filter((term) => term.status === 'open').map((term) => term.id));
    return new Set(next.filter((term) => term.status === 'closed' && openTermIds.has(term.id)).map((term) => term.name));
  }

  private initDetail(): Signal<MentorshipProgramDetail | null> {
    return toSignal(
      toObservable(this.programId).pipe(
        filter((programId) => !!programId),
        tap(() => {
          this.isLoading.set(true);
          this.termsOverride.set(null);
          this.applicantsOverride.set(null);
        }),
        switchMap((programId) => this.mentorshipService.getProgram(programId).pipe(tap(() => this.isLoading.set(false))))
      ),
      { initialValue: null }
    );
  }
}
