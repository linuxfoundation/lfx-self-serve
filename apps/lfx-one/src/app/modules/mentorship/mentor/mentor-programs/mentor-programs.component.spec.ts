// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProgramsComponent } from './mentor-programs.component';

/**
 * Programs child of the mentor shell: tab bar / page H1 belong to `MentorPageComponent`
 * and are tested there. This spec covers only the list content plus its load / error /
 * empty states and the card click.
 */
describe('MentorProgramsComponent', () => {
  const mentorProgram = (id: string, name: string): MentorshipMentorProgram => ({
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    projectName: 'LF Energy',
    term: 'Fall 2026',
    termStatus: 'active-term',
    stats: { mentees: 3, tasksToReview: 4, applicants: 5 },
  });

  const programs: MentorshipMentorProgramsResponse = {
    data: [mentorProgram('mp_gridflow_fall26', 'GridFlow: Time-Series Ingestion Pipeline')],
    total: 1,
  };

  let fixture: ComponentFixture<MentorProgramsComponent>;
  let getMentorPrograms: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    getMentorPrograms = vi.fn(() => of(programs));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: MentorshipService, useValue: { getMentorPrograms } }],
    });

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();
  });

  it('renders one card per program once loaded', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).toBeNull();
  });

  it('shows the loading state until the first response arrives', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: MentorshipService, useValue: { getMentorPrograms: () => NEVER } }],
    });

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-cards"]')).toBeNull();
  });

  it('navigates to program-detail when a program card is clicked', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')?.click();

    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentor/programs', 'mp_gridflow_fall26']);
  });

  it('renders an empty state when the mentor has no programs', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipService, useValue: { getMentorPrograms: () => of(EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE) } },
      ],
    });

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-empty-state"]')).not.toBeNull();
  });

  it('renders an error state and retries mentor programs loading', () => {
    const response$ = new Subject<MentorshipMentorProgramsResponse>();
    getMentorPrograms
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' })))
      .mockReturnValueOnce(response$);

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-error-state"]')?.textContent).toContain('Could not load your programs');

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-programs-error-state"] button')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).not.toBeNull();

    response$.next(programs);
    response$.complete();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')).not.toBeNull();
  });
});
