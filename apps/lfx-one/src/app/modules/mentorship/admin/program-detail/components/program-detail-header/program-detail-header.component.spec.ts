// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipProgram, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProgramDetailHeaderComponent } from './program-detail-header.component';

describe('ProgramDetailHeaderComponent — mentees tab label', () => {
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
    fixture.componentRef.setInput('tabCounts', { mentees: 4, applicants: 0, mentors: 2, terms: 2 });
    fixture.componentRef.setInput('activeTab', 'mentees');
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailHeaderComponent],
      providers: [provideNoopAnimations()],
    });
  });

  const menteesTabText = (): string =>
    ((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-program-detail-tab-mentees"]')?.textContent ?? '').trim();

  it('labels the tab "Current Mentees" while the program is open', () => {
    render('open');

    expect(menteesTabText()).toContain('Current Mentees');
  });

  it('labels the tab "Past Mentees" once the program is completed, keeping its count', () => {
    render('completed');

    expect(menteesTabText()).toContain('Past Mentees');
    expect(menteesTabText()).not.toContain('Current Mentees');
    // The tab keeps its `mentees` value, so the count badge is unaffected by the relabel.
    expect(menteesTabText()).toContain('4');
  });

  it('leaves the other tab labels alone when completed', () => {
    render('completed');
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="mentorship-program-detail-tab-applicants"]')?.textContent).toContain('Applicants');
    expect(element.querySelector('[data-testid="mentorship-program-detail-tab-mentors"]')?.textContent).toContain('Mentors');
    expect(element.querySelector('[data-testid="mentorship-program-detail-tab-terms"]')?.textContent).toContain('Terms');
  });
});
