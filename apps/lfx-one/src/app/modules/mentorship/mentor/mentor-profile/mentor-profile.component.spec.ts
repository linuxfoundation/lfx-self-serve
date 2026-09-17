// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MentorProfileEditDrawerComponent } from './components/mentor-profile-edit-drawer/mentor-profile-edit-drawer.component';
import { MentorProfileEditDrawerService } from './components/mentor-profile-edit-drawer/mentor-profile-edit-drawer.service';
import { MentorProfileComponent } from './mentor-profile.component';

/**
 * ProfileCardComponent fetches three endpoints of its own on construct and depends on the
 * OIDC user shell. The page's tests are about page-level composition, so stub the card
 * with a tag that renders nothing — the tests still verify the card is mounted in place.
 */
@Component({
  selector: 'lfx-mentorship-profile-card',
  template: '<div data-testid="mentorship-profile-card-stub"></div>',
})
class StubProfileCardComponent {}

/**
 * Stub out the drawer to avoid pulling in its child components (PrimeNG drawer, rich editor,
 * skills picker, resume section). The drawer's own spec covers its behavior.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile-edit-drawer',
  template: '',
})
class StubMentorProfileEditDrawerComponent {}

describe('MentorProfileComponent', () => {
  const mockProfile: MentorshipMentorProfileResponse = {
    profile: {
      aboutMe: 'Maintainer working on telemetry.',
      skills: ['Python', 'Go'],
      resumeFileName: 'test-mentor-resume.pdf',
      resumeUrl: 'https://example.com/resume.pdf',
    },
    history: [{ id: 'mh_active', programName: 'GridFlow: Ingestion Pipeline', term: 'Fall 2026', menteesCount: 3, status: 'in-progress' }],
  };

  let fixture: ComponentFixture<MentorProfileComponent>;
  let drawerService: MentorProfileEditDrawerService;
  let getMentorProfile: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (): Promise<void> => {
    await TestBed.overrideComponent(MentorProfileComponent, {
      remove: { imports: [ProfileCardComponent, MentorProfileEditDrawerComponent] },
      add: { imports: [StubProfileCardComponent, StubMentorProfileEditDrawerComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(MentorProfileComponent);
    // The drawer service is provided at the component level, so retrieve it from the
    // component's own injector — the TestBed-level provider is a different instance.
    drawerService = fixture.debugElement.injector.get(MentorProfileEditDrawerService);
    fixture.detectChanges();
  };

  beforeEach(() => {
    getMentorProfile = vi.fn(() => of(mockProfile));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProfileComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipService, useValue: { getMentorProfile } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('renders every top-level section once loaded — the shell owns the page H1, so this child does not', async () => {
    await bootstrap();

    // Page H1 lives on `MentorPageComponent`; asserting it here would couple the child to
    // the shell's markup.
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-title"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-profile-card-stub"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentoring-history"]')).not.toBeNull();
  });

  it('shows the mentoring history rows loaded from the BFF', async () => {
    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-mentoring-history-row-mh_active"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-loading"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-error-state"]')).toBeNull();
  });

  it('composes profile card → details → history in that order, matching the design', async () => {
    await bootstrap();

    const testIds = [...element().querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));
    const card = testIds.indexOf('mentorship-profile-card-stub');
    const details = testIds.indexOf('mentorship-mentor-profile-details');
    const history = testIds.indexOf('mentorship-mentoring-history');

    expect(card).toBeLessThan(details);
    expect(details).toBeLessThan(history);
  });

  it('opens the mentor profile edit drawer when the mentor asks to edit the profile', async () => {
    await bootstrap();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-profile-details-edit"] button')?.click();

    expect(drawerService.isOpen()).toBe(true);
    expect(drawerService.context()).toEqual(mockProfile.profile);
  });

  it('renders an error state and retries the load when the mentor clicks Retry', async () => {
    const response$ = new Subject<MentorshipMentorProfileResponse>();
    getMentorProfile
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, statusText: 'Service Unavailable' })))
      .mockReturnValueOnce(response$);

    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-error-state"]')?.textContent).toContain('Could not load your mentor profile');
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details"]')).toBeNull();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-profile-error-state"] button')?.click();
    fixture.detectChanges();

    // The retry hides the error and shows the loading state until the next response arrives.
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-loading"]')).not.toBeNull();

    response$.next(mockProfile);
    response$.complete();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-error-state"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details"]')).not.toBeNull();
  });

  it('degrades to the empty response so the page never renders a partial profile after a failure', async () => {
    getMentorProfile.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    await bootstrap();

    // The observable emits the empty response through the catch, which is what backs
    // both the details card and the history section — the error state is the mentor's
    // only signal, not a half-rendered profile.
    expect(fixture.componentInstance['profile']()).toEqual(EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE.profile);
    expect(fixture.componentInstance['history']()).toEqual(EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE.history);
  });
});
