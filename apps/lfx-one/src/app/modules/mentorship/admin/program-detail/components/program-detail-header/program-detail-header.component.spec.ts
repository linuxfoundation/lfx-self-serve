// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipProgram, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProgramDetailHeaderComponent } from './program-detail-header.component';

describe('ProgramDetailHeaderComponent — tabs', () => {
  const program = (status: MentorshipProgramStatus): MentorshipProgram => ({
    id: 'mp_1',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    status,
    stats: { mentors: 2, mentees: 0, graduated: 3 },
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  });

  let fixture: ComponentFixture<ProgramDetailHeaderComponent>;

  const render = (status: MentorshipProgramStatus): void => {
    fixture = TestBed.createComponent(ProgramDetailHeaderComponent);
    fixture.componentRef.setInput('program', program(status));
    fixture.componentRef.setInput('tabCounts', { currentMentees: 4, pastMentees: 7, mentors: 2, terms: 3 });
    fixture.componentRef.setInput('activeTab', 'current-mentees');
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailHeaderComponent],
      providers: [provideNoopAnimations()],
    });
  });

  const tabText = (value: string): string =>
    ((fixture.nativeElement as HTMLElement).querySelector(`[data-testid="mentorship-program-detail-tab-${value}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  it('renders the four tabs in order, each with its own count', () => {
    render('open');

    expect(tabText('current-mentees')).toBe('Current Mentees 4');
    expect(tabText('past-mentees')).toBe('Past Mentees 7');
    expect(tabText('mentors')).toBe('Mentors 2');
    expect(tabText('terms')).toBe('Terms 3');
  });

  it('keeps the same labels once the program is completed', () => {
    render('completed');

    expect(tabText('current-mentees')).toBe('Current Mentees 4');
    expect(tabText('past-mentees')).toBe('Past Mentees 7');
  });
});
