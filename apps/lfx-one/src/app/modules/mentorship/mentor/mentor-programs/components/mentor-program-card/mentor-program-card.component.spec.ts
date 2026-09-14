// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipMentorProgram } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProgramCardComponent } from './mentor-program-card.component';

describe('MentorProgramCardComponent', () => {
  const mentorProgram: MentorshipMentorProgram = {
    id: 'mp_gridflow_fall26',
    slug: 'gridflow-time-series-ingestion-pipeline',
    name: 'GridFlow: Time-Series Ingestion Pipeline',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    termStatus: 'active-term',
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

  it('renders the season line, term badge, and title', () => {
    expect(element().textContent).toContain('LF Energy · Fall 2026');
    expect(element().textContent).toContain('Active term');
    expect(element().textContent).toContain('GridFlow: Time-Series Ingestion Pipeline');
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
