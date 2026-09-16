// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
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
  let notify: ReturnType<typeof vi.fn>;
  let getMentorPrograms: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    notify = vi.fn();
    getMentorPrograms = vi.fn(() => of(programs));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MentorshipService, useValue: { getMentorPrograms } },
        { provide: MentorshipComingSoonService, useValue: { notify } },
      ],
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
      providers: [
        provideNoopAnimations(),
        { provide: MentorshipService, useValue: { getMentorPrograms: () => NEVER } },
        { provide: MentorshipComingSoonService, useValue: { notify } },
      ],
    });

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-cards"]')).toBeNull();
  });

  it('raises a coming-soon toast when a program card is clicked', () => {
    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')?.click();

    expect(notify).toHaveBeenCalledWith('Open GridFlow: Time-Series Ingestion Pipeline');
  });

  it('renders an empty state when the mentor has no programs', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MentorshipService, useValue: { getMentorPrograms: () => of(EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE) } },
        { provide: MentorshipComingSoonService, useValue: { notify } },
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
