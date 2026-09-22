// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED, MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT } from '@lfx-one/shared/constants';
import { MentorshipComingSoonService } from '@modules/mentorship/services/mentorship-coming-soon.service';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeApplicantTasksComponent } from './mentee-applicant-tasks.component';

describe('MenteeApplicantTasksComponent', () => {
  let fixture: ComponentFixture<MenteeApplicantTasksComponent>;
  let component: MenteeApplicantTasksComponent;
  let getMenteeOverview: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const createComponent = async (): Promise<void> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplicantTasksComponent],
      providers: [
        { provide: MentorshipService, useValue: { getMenteeOverview } },
        { provide: MentorshipComingSoonService, useValue: { notify: vi.fn() } },
      ],
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(MenteeApplicantTasksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const bootstrap = async (): Promise<void> => {
    getMenteeOverview = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_OVERVIEW_APPLICANT));
    await createComponent();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders application cards with prerequisite tasks', async () => {
    await bootstrap();
    const cards = element().querySelectorAll('[data-testid^="mentee-tasks-application-card-"]');
    expect(cards.length).toBe(3);
    const text = element().textContent ?? '';
    expect(text).toContain('Apicurio Registry');
    expect(text).toContain('PREREQUISITE TASKS');
  });

  it('renders task rows inside each application card', async () => {
    await bootstrap();
    const taskRows = element().querySelectorAll('[data-testid^="mentee-tasks-task-row-"]');
    expect(taskRows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders status badges for application cards', async () => {
    await bootstrap();
    const text = element().textContent ?? '';
    expect(text).toContain('In Progress');
    expect(text).toContain('Awaiting Review');
  });

  it('shows submitted count per application', async () => {
    await bootstrap();
    const text = element().textContent ?? '';
    expect(text).toContain('1 of 3 submitted');
    expect(text).toContain('3 of 3 submitted');
  });

  it('shows upload button for tasks needing upload', async () => {
    await bootstrap();
    const uploadBtns = element().querySelectorAll('[data-testid^="mentee-tasks-upload-"]');
    expect(uploadBtns.length).toBeGreaterThan(0);
  });

  it('shows view/download icons for uploaded files', async () => {
    await bootstrap();
    const viewBtns = element().querySelectorAll('[data-testid^="mentee-tasks-view-file-"]');
    expect(viewBtns.length).toBeGreaterThan(0);
  });

  it('adds aria-label on icon-only file buttons', async () => {
    await bootstrap();
    const viewBtn = element().querySelector('[data-testid^="mentee-tasks-view-file-"]');
    expect(viewBtn?.getAttribute('aria-label')).toContain('View submission for');
    const downloadBtn = element().querySelector('[data-testid^="mentee-tasks-download-file-"]');
    expect(downloadBtn?.getAttribute('aria-label')).toContain('Download submission for');
  });

  it('shows error state when the overview API fails', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(throwError(() => new Error('Network error')));
    await createComponent();
    expect(component['error']()).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-error"]')).toBeTruthy();
  });

  it('shows a terminal error (not an endless spinner) when the overview resolves to a non-applicant phase', async () => {
    getMenteeOverview = vi.fn().mockReturnValue(of(MOCK_MENTORSHIP_MENTEE_OVERVIEW_ACCEPTED));
    await createComponent();
    expect(component['loaded']()).toBe(true);
    expect(component['error']()).toBeTruthy();
    expect(element().querySelector('[data-testid="mentee-tasks-error"]')).toBeTruthy();
  });

  it('retries the overview fetch on retry click', async () => {
    await bootstrap();
    const callsBefore = getMenteeOverview.mock.calls.length;
    component['retry']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getMenteeOverview.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
