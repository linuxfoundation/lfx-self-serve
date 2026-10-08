// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES, MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgram } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProgramCardComponent } from './mentor-program-card.component';

describe('MentorProgramCardComponent', () => {
  const mentorProgram: MentorshipMentorProgram = {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    status: 'open',
    stats: { mentees: 3, tasksToReview: 4, applicants: 5 },
  };

  let fixture: ComponentFixture<MentorProgramCardComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramCardComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MentorProgramCardComponent);
    fixture.componentRef.setInput('program', mentorProgram);
    fixture.detectChanges();
  });

  it('renders the project name alone as the season line, the status badge, and the title', () => {
    const season = Array.from(element().querySelectorAll('span')).find((span) => span.textContent?.trim() === 'LF Energy');
    expect(season).toBeDefined();
    expect(element().textContent).not.toContain('·');
    expect(element().textContent).toContain(MENTORSHIP_PROGRAM_STATUS_LABELS.open);
    expect(element().textContent).toContain('GridFlow: Time-Series Ingestion Pipeline');
  });

  it('shows a Completed badge once every term of the program is closed', () => {
    fixture.componentRef.setInput('program', { ...mentorProgram, status: 'completed' });
    fixture.detectChanges();

    const badge = Array.from(element().querySelectorAll('span')).find((span) => span.textContent?.trim() === MENTORSHIP_PROGRAM_STATUS_LABELS.completed);
    expect(badge).toBeDefined();
    for (const cls of MENTORSHIP_PROGRAM_STATUS_BADGE_CLASSES.completed.split(' ')) {
      expect(badge?.classList.contains(cls)).toBe(true);
    }
  });

  it('renders mentor metrics', () => {
    const metrics = element().querySelector('[data-testid="mentorship-mentor-program-card-metrics"]');

    expect(metrics?.textContent).toContain('Mentees');
    expect(metrics?.textContent).toContain('3');
    expect(metrics?.textContent).toContain('Tasks to Review');
    expect(metrics?.textContent).toContain('4');
    expect(metrics?.textContent).toContain('Applicants');
    expect(metrics?.textContent).toContain('5');
  });

  it('emits the program id when the card is clicked', () => {
    const onClick = vi.fn();
    fixture.componentInstance.cardClick.subscribe(onClick);

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')?.click();

    expect(onClick).toHaveBeenCalledWith('mp_gridflow_fall26');
  });

  it('emits the program id when Enter is pressed on the card', () => {
    const onClick = vi.fn();
    fixture.componentInstance.cardClick.subscribe(onClick);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')?.dispatchEvent(event);

    expect(onClick).toHaveBeenCalledWith('mp_gridflow_fall26');
    expect(event.defaultPrevented).toBe(false);
  });

  it('emits the program id and prevents page scroll when Space is pressed on the card', () => {
    const onClick = vi.fn();
    fixture.componentInstance.cardClick.subscribe(onClick);

    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-program-card-mp_gridflow_fall26"]')?.dispatchEvent(event);

    expect(onClick).toHaveBeenCalledWith('mp_gridflow_fall26');
    expect(event.defaultPrevented).toBe(true);
  });
});
