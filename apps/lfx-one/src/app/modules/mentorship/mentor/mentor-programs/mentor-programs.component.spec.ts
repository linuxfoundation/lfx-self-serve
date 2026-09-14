// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EMPTY_MENTORSHIP_MENTOR_PROGRAMS_RESPONSE, MENTORSHIP_MENTOR_PROGRAMS_PAGE_TITLE } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram, MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { NEVER, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorProgramsComponent } from './mentor-programs.component';

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

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    notify = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MentorshipService, useValue: { getMentorPrograms: () => of(programs) } },
        { provide: MentorshipComingSoonService, useValue: { notify } },
      ],
    });

    fixture = TestBed.createComponent(MentorProgramsComponent);
    fixture.detectChanges();
  });

  it('renders the page title and program cards once loaded', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-title"]')?.textContent?.trim()).toBe(MENTORSHIP_MENTOR_PROGRAMS_PAGE_TITLE);
    expect(element().querySelector('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).toBeNull();
  });

  it('shows the program count on the My Programs tab', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-tab-programs"]')?.textContent).toContain('1');
  });

  it('hides the My Programs count badge until programs finish loading', () => {
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

    const tabText = element().querySelector('[data-testid="mentorship-mentor-programs-tab-programs"]')?.textContent?.trim() ?? '';
    expect(tabText).toBe('My Programs');
    expect(tabText).not.toContain('0');
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-loading"]')).not.toBeNull();
  });

  it('switches to the Mentor Profile tab', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-programs-tab-profile"]')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-profile-panel"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-programs-list"]')).toBeNull();
  });

  it('moves focus across tabs with ArrowRight', () => {
    const tablist = element().querySelector('[data-testid="mentorship-mentor-programs-tabs"]') as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    tablist.dispatchEvent(event);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-programs-profile-panel"]')).not.toBeNull();
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
});
