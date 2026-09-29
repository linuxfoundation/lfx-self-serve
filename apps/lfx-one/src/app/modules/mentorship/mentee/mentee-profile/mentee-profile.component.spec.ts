// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MenteeProfileEditDrawerComponent } from './components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from './components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.service';
import { MenteeProfileComponent } from './mentee-profile.component';

@Component({
  selector: 'lfx-mentorship-profile-card',
  template: '<div data-testid="mentorship-profile-card-stub"></div>',
})
class StubProfileCardComponent {}

@Component({
  selector: 'lfx-mentorship-mentee-profile-edit-drawer',
  template: '',
})
class StubMenteeProfileEditDrawerComponent {}

describe('MenteeProfileComponent', () => {
  const mockProfile: MentorshipMenteeProfileResponse = {
    profile: {
      aboutMe: 'Student working on telemetry.',
      skillsHave: ['Python', 'Go'],
      skillsWant: ['Kubernetes'],
      resumeFileName: 'test-mentee-resume.pdf',
      resumeUrl: 'https://example.com/resume.pdf',
    },
    history: [
      {
        id: 'app_pending',
        programId: 'prog_gridflow',
        programName: 'GridFlow: Ingestion Pipeline',
        termName: 'Fall 2026',
        submittedOn: 'Jun 28, 2026',
        status: 'pending',
      },
    ],
  };

  let fixture: ComponentFixture<MenteeProfileComponent>;
  let drawerService: MenteeProfileEditDrawerService;
  let getMenteeProfile: ReturnType<typeof vi.fn>;
  let withdrawMenteeApplication: ReturnType<typeof vi.fn>;
  let applicationsRevision: ReturnType<typeof signal<number>>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (): Promise<void> => {
    await TestBed.overrideComponent(MenteeProfileComponent, {
      remove: { imports: [ProfileCardComponent, MenteeProfileEditDrawerComponent] },
      add: { imports: [StubProfileCardComponent, StubMenteeProfileEditDrawerComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(MenteeProfileComponent);
    drawerService = fixture.debugElement.injector.get(MenteeProfileEditDrawerService);
    fixture.detectChanges();
  };

  beforeEach(() => {
    getMenteeProfile = vi.fn(() => of(mockProfile));
    applicationsRevision = signal(0);
    // The real data service bumps the revision when a withdraw succeeds.
    withdrawMenteeApplication = vi.fn(() => {
      applicationsRevision.update((value) => value + 1);
      return of(undefined);
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeProfileComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: MentorshipMenteeService,
          useValue: { getMenteeProfile, withdrawMenteeApplication, clearMenteeCaches: vi.fn(), menteeApplicationsRevision: applicationsRevision.asReadonly() },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('renders every top-level section once loaded — the shell owns the page H1, so this child does not', async () => {
    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-title"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-profile-card-stub"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-application-history"]')).not.toBeNull();
  });

  it('shows the application history rows loaded from the BFF', async () => {
    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-application-history-row-app_pending"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-loading"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-error-state"]')).toBeNull();
  });

  it('composes profile card → details → history in that order, matching the design', async () => {
    await bootstrap();

    const testIds = [...element().querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));
    const card = testIds.indexOf('mentorship-profile-card-stub');
    const details = testIds.indexOf('mentorship-mentee-profile-details');
    const history = testIds.indexOf('mentorship-application-history');

    expect(card).toBeLessThan(details);
    expect(details).toBeLessThan(history);
  });

  it('opens the mentee profile edit drawer when the mentee asks to edit the profile', async () => {
    await bootstrap();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-profile-details-edit"] button')?.click();

    expect(drawerService.isOpen()).toBe(true);
    expect(drawerService.context()).toEqual(mockProfile.profile);
  });

  it('renders an error state and retries the load when the mentee clicks Retry', async () => {
    const response$ = new Subject<MentorshipMenteeProfileResponse>();
    getMenteeProfile
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' })))
      .mockReturnValueOnce(response$);

    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-error-state"]')?.textContent).toContain('Could not load your mentee profile');
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details"]')).toBeNull();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-profile-error-state"] button')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-loading"]')).not.toBeNull();

    response$.next(mockProfile);
    response$.complete();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-error-state"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details"]')).not.toBeNull();
  });

  it('degrades to the empty response so the page never renders a partial profile after a failure', async () => {
    getMenteeProfile.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await bootstrap();

    expect(fixture.componentInstance['profile']()).toEqual(EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE.profile);
    expect(fixture.componentInstance['history']()).toEqual(EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE.history);
  });

  it('keeps Application History rendering when the BFF omits history', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getMenteeProfile.mockReturnValue(of({ profile: mockProfile.profile } as MentorshipMenteeProfileResponse));

    await bootstrap();

    expect(fixture.componentInstance['history']()).toEqual([]);
    expect(element().querySelector('[data-testid="mentorship-application-history"]')).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('omitted history'));
    warn.mockRestore();
  });

  it('withdraws a pending application from Application History after the mentee confirms, then re-reads the profile', async () => {
    await bootstrap();
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    const confirm = vi.spyOn(confirmationService, 'confirm').mockImplementation((confirmation: Confirmation) => {
      confirmation.accept?.();
      return confirmationService;
    });

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-application-history-withdraw-app_pending"]')?.click();
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(withdrawMenteeApplication).toHaveBeenCalledWith('app_pending');
    expect(getMenteeProfile).toHaveBeenCalledTimes(2);
  });
});
