// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT, MOCK_MENTORSHIP_MENTEE_TASKS } from '@lfx-one/shared/constants';
import { MentorshipMenteePhase } from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeApplicationTasksComponent } from './mentee-application-tasks.component';

describe('MenteeApplicationTasksComponent (phase orchestrator)', () => {
  let fixture: ComponentFixture<MenteeApplicationTasksComponent>;
  let component: MenteeApplicationTasksComponent;
  let routerNavigate: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** Boot the orchestrator in the phase the shell reports, with both child fetches mocked. */
  const bootstrap = async (phase: MentorshipMenteePhase): Promise<void> => {
    routerNavigate = vi.fn().mockResolvedValue(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicationTasksComponent],
      providers: [
        {
          provide: MentorshipService,
          useValue: {
            getMenteeOverview: vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT)),
            getMenteeTasks: vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_TASKS)),
          },
        },
        { provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } },
        { provide: Router, useValue: { navigate: routerNavigate } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicationTasksComponent);
    component = fixture.componentInstance;
    // The shell pushes the resolved phase into the child on activation.
    component.phase.set(phase);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the applicant child when the shell reports the applicant phase', async () => {
    await bootstrap('applicant');
    expect(component['resolvedPhase']()).toBe('applicant');
    expect(element().querySelector('lfx-mentee-applicant-tasks')).toBeTruthy();
    expect(element().querySelector('lfx-mentee-accepted-tasks')).toBeNull();
  });

  it('renders the accepted child when the shell reports the accepted phase', async () => {
    await bootstrap('accepted');
    expect(component['resolvedPhase']()).toBe('accepted');
    expect(element().querySelector('lfx-mentee-accepted-tasks')).toBeTruthy();
    expect(element().querySelector('lfx-mentee-applicant-tasks')).toBeNull();
  });

  it('redirects to the overview when the phase is empty (no tasks tab exists)', async () => {
    await bootstrap('empty');
    expect(routerNavigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    // No phase child renders while the redirect is in flight.
    expect(element().querySelector('lfx-mentee-applicant-tasks')).toBeNull();
    expect(element().querySelector('lfx-mentee-accepted-tasks')).toBeNull();
    expect(element().querySelector('[data-testid="mentee-tasks-redirecting"]')).toBeTruthy();
  });
});
