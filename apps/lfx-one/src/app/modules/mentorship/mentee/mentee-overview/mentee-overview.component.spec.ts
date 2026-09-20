// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT,
  MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeOverviewResponse } from '@lfx-one/shared/interfaces';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeOverviewComponent } from './mentee-overview.component';

describe('MenteeOverviewComponent', () => {
  let fixture: ComponentFixture<MenteeOverviewComponent>;
  let component: MenteeOverviewComponent;
  let getMenteeOverview: ReturnType<typeof vi.fn>;
  let comingSoonNotify: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (response: MentorshipMenteeOverviewResponse = MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY): Promise<void> => {
    getMenteeOverview = vi.fn().mockReturnValue(of(response));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeOverviewComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Empty phase ----------------------------------------------------------

  it('renders the empty state with CTA', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY);
    expect(element().textContent).toContain("You haven't applied to a program yet");
    expect(element().querySelector('a[href]')?.textContent).toContain('Find a Program');
  });

  it('emits phase "empty" and openTaskCount 0', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_OVERVIEW_EMPTY));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeOverviewComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeOverviewComponent);
    component = fixture.componentInstance;

    const phaseSpy = vi.fn();
    const taskCountSpy = vi.fn();
    component.phaseChange.subscribe(phaseSpy);
    component.openTaskCountChange.subscribe(taskCountSpy);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(phaseSpy).toHaveBeenCalledWith('empty');
    expect(taskCountSpy).toHaveBeenCalledWith(0);
  });

  // ---- Applicant phase ------------------------------------------------------

  it('renders application cards with nested term name', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT);
    const cards = element().querySelectorAll('.rounded-xl.border');
    expect(cards.length).toBeGreaterThan(0);
    const text = element().textContent ?? '';
    expect(text).toContain('Fall 2026');
    expect(text).toContain('Apicurio Registry');
  });

  it('renders status badges for in-progress and awaiting-review', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT);
    const text = element().textContent ?? '';
    expect(text).toContain('In Progress');
    expect(text).toContain('Awaiting Review');
  });

  it('renders the past applications table with split projectName and termName', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT);
    const text = element().textContent ?? '';
    expect(text).toContain('Past Applications');
    expect(text).toContain('CNCF');
    expect(text).toContain('Summer 2026');
    expect(text).toContain('Not selected');
  });

  it('labels the date column "Last Updated" not "Submitted"', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT);
    const headers = Array.from(element().querySelectorAll('th'));
    const lastUpdatedHeader = headers.find((th) => th.textContent?.trim() === 'Last Updated');
    expect(lastUpdatedHeader).toBeDefined();
    const submittedHeader = headers.find((th) => th.textContent?.trim() === 'Submitted');
    expect(submittedHeader).toBeUndefined();
  });

  it('emits applicant phase and open task count', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeOverviewComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeOverviewComponent);
    component = fixture.componentInstance;

    const phaseSpy = vi.fn();
    const taskCountSpy = vi.fn();
    component.phaseChange.subscribe(phaseSpy);
    component.openTaskCountChange.subscribe(taskCountSpy);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(phaseSpy).toHaveBeenCalledWith('applicant');
    expect(taskCountSpy).toHaveBeenCalledWith(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT.openTaskCount);
  });

  // ---- Accepted phase -------------------------------------------------------

  it('renders the active program card with mentors', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED);
    const text = element().textContent ?? '';
    expect(text).toContain('GridFlow: Time-Series Ingestion Pipeline');
    expect(text).toContain('Test Mentor A');
    expect(text).toContain('Test Mentor B');
    expect(text).toContain('YOUR MENTORS');
  });

  it('renders mentor avatar fallback initials via InitialsPipe', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED);
    const avatarFallbacks = element().querySelectorAll('.rounded-full.bg-primary-100');
    expect(avatarFallbacks.length).toBe(2);
    expect(avatarFallbacks[0].textContent?.trim()).toBe('T');
    expect(avatarFallbacks[1].textContent?.trim()).toBe('T');
  });

  it('renders up-next tasks with formatted ISO dates', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED);
    const text = element().textContent ?? '';
    expect(text).toContain('Implement replay from durable buffer');
    expect(text).toContain('In Progress');
    expect(text).toContain('To Do');
    expect(text).toContain('Sep 18');
  });

  it('renders the progress bar with percentage', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED);
    const text = element().textContent ?? '';
    expect(text).toContain('58%');
    expect(text).toContain('7 of');
    expect(text).toContain('12 tasks');
  });

  it('renders the Active badge', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED);
    expect(element().textContent).toContain('Active');
  });

  // ---- Error handling -------------------------------------------------------

  it('sets loadError on API failure', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(throwError(() => new Error('Network error')));
    comingSoonNotify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeOverviewComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview } },
        { provide: MentorshipComingSoonService, useValue: { notify: comingSoonNotify } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['loadError']()).toBeTruthy();
    expect(component['hasLoaded']()).toBe(true);
  });

  // ---- Withdraw action ------------------------------------------------------

  it('calls comingSoonService.notify on withdraw', async () => {
    await bootstrap(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT);
    const app = MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT.applications[0];
    component['onWithdraw'](app);
    expect(comingSoonNotify).toHaveBeenCalledWith('Coming Soon');
  });
});
