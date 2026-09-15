// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorProgramCardComponent } from './components/mentor-program-card/mentor-program-card.component';

/**
 * Programs child of the mentor shell — mounts at `mentor/programs` inside
 * `MentorPageComponent`'s `<router-outlet>`. Owns just the list content plus its
 * loading / error / empty states; the shell owns the page H1 and the tab bar,
 * so this component renders neither.
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

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly reloadPrograms = signal(0);

  private readonly programsState: Signal<MentorshipMentorProgramsResponse> = this.initPrograms();
  protected readonly programs = computed(() => this.programsState().data);

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
              this.loadError.set(serverAuthoredMessage(error, 'We could not load your mentor programs. Please retry.'));
              return of(EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE);
            })
          )
        )
      ),
      { initialValue: EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE }
    );
  }
}
