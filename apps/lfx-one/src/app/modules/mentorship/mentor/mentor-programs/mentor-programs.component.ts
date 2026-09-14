// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, PLATFORM_ID, signal, Signal, viewChildren } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE, MENTORSHIP_MENTOR_PAGE_TABS, MENTORSHIP_MENTOR_PROGRAMS_PAGE_TITLE } from '@lfx-one/shared/constants';
import { MentorshipMentorPageTab, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorProgramCardComponent } from './components/mentor-program-card/mentor-program-card.component';

/**
 * Mentor landing page for signed-in mentors. Lists the programs they mentor on
 * the My Programs tab; Mentor Profile is a placeholder until that surface ships.
 */
@Component({
  selector: 'lfx-mentorship-mentor-programs',
  imports: [CardComponent, EmptyStateComponent, MentorProgramCardComponent, RouteLoadingComponent],
  templateUrl: './mentor-programs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProgramsComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  protected readonly title = MENTORSHIP_MENTOR_PROGRAMS_PAGE_TITLE;
  protected readonly tabs = MENTORSHIP_MENTOR_PAGE_TABS;
  protected readonly activeTab = signal<MentorshipMentorPageTab>('programs');
  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly reloadPrograms = signal(0);

  private readonly programsState: Signal<MentorshipMentorProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);
  protected readonly programCount = computed(() => this.programsState().total);

  protected readonly tabItems = computed(() =>
    this.tabs.map((tab) => ({
      ...tab,
      count: tab.value === 'programs' && this.hasLoaded() ? this.programCount() : null,
    }))
  );

  protected onTabClick(tab: MentorshipMentorPageTab): void {
    this.activeTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs.map((tab) => tab.value);
    const current = tabs.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.activeTab.set(tabs[next]);
    if (isPlatformBrowser(this.platformId)) {
      this.tabBtns()[next]?.nativeElement.focus();
    }
  }

  protected onProgramClick(programId: string): void {
    const program = this.programs().find((item) => item.id === programId);
    this.comingSoon.notify(program ? `Open ${program.name}` : 'Open program');
  }

  protected retryPrograms(): void {
    this.reloadPrograms.update((value) => value + 1);
  }

  private initPrograms(): Signal<MentorshipMentorProgramsResponse> {
    return toSignal(
      toObservable(this.reloadPrograms).pipe(
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.mentorshipService.getMentorPrograms().pipe(
            map((response) => {
              this.hasLoaded.set(true);
              return response;
            }),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(typeof error.error?.message === 'string' ? error.error.message : 'We could not load your mentor programs. Please retry.');
              return of(EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE);
            })
          )
        )
      ),
      { initialValue: EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE }
    );
  }
}
