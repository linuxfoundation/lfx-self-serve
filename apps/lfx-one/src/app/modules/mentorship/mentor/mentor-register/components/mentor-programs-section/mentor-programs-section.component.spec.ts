// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS, MENTORSHIP_MENTOR_STATUS_LABELS, MENTORSHIP_MENTOR_STATUSES } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramRequest, MentorshipProgram } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentorProgramsSectionComponent } from './mentor-programs-section.component';

describe('MentorProgramsSectionComponent', () => {
  const program = (id: string, name: string): MentorshipProgram => ({
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    projectName: 'LF Energy',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 2, mentees: 1, graduated: 0 },
    createdOn: '2026-05-01',
    updatedOn: '2026-07-02',
  });

  const request: MentorshipMentorProgramRequest = {
    id: 'req_1',
    programId: 'mp_kubernetes',
    programName: 'Kubernetes Contributors',
    status: 'accepted',
  };

  let fixture: ComponentFixture<MentorProgramsSectionComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramsSectionComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MentorProgramsSectionComponent);
    fixture.componentRef.setInput('programs', [program('mp_kubernetes', 'Kubernetes Contributors'), program('mp_gridflow', 'GridFlow Ingestion')]);
    fixture.componentRef.setInput('requests', [request]);
    fixture.detectChanges();
  });

  it('offers only programs the mentor has not already requested', () => {
    expect(fixture.componentInstance['availablePrograms']().map((option) => option.value)).toEqual(['mp_gridflow']);
  });

  it('emits the picked program and clears the select, so it never looks selected', () => {
    const added: MentorshipProgram[] = [];
    fixture.componentInstance.add.subscribe((program) => added.push(program));

    fixture.componentInstance['pickerForm'].controls.programId.setValue('mp_gridflow');
    fixture.detectChanges();

    expect(added.map((program) => program.id)).toEqual(['mp_gridflow']);
    expect(fixture.componentInstance['pickerForm'].controls.programId.value).toBeNull();
  });

  it('renders one row per request, with its status badge', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-request-status-req_1"]')?.textContent?.trim()).toBe('Accepted');
  });

  it('calls an undecided request Pending, not Invited as the admin tab does', () => {
    // Same wire status, opposite direction: the admin invited them, or they asked to join.
    fixture.componentRef.setInput('requests', [{ ...request, status: 'pending' }]);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-request-status-req_1"]')?.textContent?.trim()).toBe('Pending');
    expect(MENTORSHIP_MENTOR_STATUS_LABELS.pending).toBe('Invited');
  });

  it('reuses the admin wording for every status it does not deliberately override', () => {
    for (const status of MENTORSHIP_MENTOR_STATUSES.filter((value) => value !== 'pending')) {
      expect(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS[status]).toBe(MENTORSHIP_MENTOR_STATUS_LABELS[status]);
    }
  });

  it('names the program in the withdraw label, since every row has the same button text', () => {
    const withdraw = element().querySelector('[data-testid="mentorship-mentor-withdraw-req_1"]');

    expect(withdraw?.querySelector('button')?.getAttribute('aria-label')).toBe('Withdraw request to join Kubernetes Contributors');
  });

  it('emits the request id on withdraw rather than removing the row itself', () => {
    const withdrawn: string[] = [];
    fixture.componentInstance.withdraw.subscribe((id) => withdrawn.push(id));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-withdraw-req_1"] button')?.click();

    expect(withdrawn).toEqual(['req_1']);
    // The parent owns the list, because it — not this section — will POST the registration.
    expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
  });

  it('hides the request table entirely when nothing has been requested', () => {
    fixture.componentRef.setInput('requests', []);
    fixture.detectChanges();

    expect(element().querySelector('table')).toBeNull();
  });
});
