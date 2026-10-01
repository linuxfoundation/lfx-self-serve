// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS, MENTORSHIP_MENTOR_STATUS_LABELS, MENTORSHIP_MENTOR_STATUSES } from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram, MentorshipMentorProgramRequest } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { MentorProgramsSectionComponent } from './mentor-programs-section.component';

describe('MentorProgramsSectionComponent', () => {
  const program = (id: string, name: string): MentorshipMentorOpenProgram => ({ id, name });

  const request: MentorshipMentorProgramRequest = {
    id: 'req_1',
    programId: 'mp_kubernetes',
    programName: 'Kubernetes Contributors',
    status: 'accepted',
  };

  let fixture: ComponentFixture<MentorProgramsSectionComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const withdrawButton = (id: string): HTMLButtonElement | null =>
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-mentor-withdraw-${id}"] button`);

  /** Lists the default request as pending, the only status that can be withdrawn. */
  const showPending = (): void => {
    fixture.componentRef.setInput('requests', [{ ...request, status: 'pending' }]);
    fixture.detectChanges();
  };

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

  it('offers a program again once its request is withdrawn, since asking again reopens it', () => {
    fixture.componentRef.setInput('requests', [{ ...request, status: 'withdrawn' }]);
    fixture.detectChanges();

    expect(fixture.componentInstance['availablePrograms']().map((option) => option.value)).toEqual(['mp_kubernetes', 'mp_gridflow']);
  });

  it.each(['pending', 'declined'] as const)('keeps a program out of the picker while its request is %s, since upstream would refuse another', (status) => {
    fixture.componentRef.setInput('requests', [{ ...request, status }]);
    fixture.detectChanges();

    expect(fixture.componentInstance['availablePrograms']().map((option) => option.value)).toEqual(['mp_gridflow']);
  });

  it('keeps a program out of the picker while the mentor holds an invitation to it, since upstream would refuse a request', () => {
    fixture.componentRef.setInput('requests', []);
    fixture.componentRef.setInput('invitedProgramIds', ['mp_kubernetes']);
    fixture.detectChanges();

    expect(fixture.componentInstance['availablePrograms']().map((option) => option.value)).toEqual(['mp_gridflow']);
  });

  it('disables the select while a request is being sent, and re-enables it after', () => {
    const control = fixture.componentInstance['pickerForm'].controls.programId;

    fixture.componentRef.setInput('requesting', true);
    fixture.detectChanges();
    expect(control.disabled).toBe(true);

    fixture.componentRef.setInput('requesting', false);
    fixture.detectChanges();
    expect(control.disabled).toBe(false);
  });

  it('emits the picked program and clears the select, so it never looks selected', () => {
    const added: MentorshipMentorOpenProgram[] = [];
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

  it.each(['accepted', 'declined', 'withdrawn', 'graduated'] as const)(
    'offers no Withdraw on a %s request, since only a pending one can be withdrawn',
    (status) => {
      fixture.componentRef.setInput('requests', [{ ...request, status }]);
      fixture.detectChanges();

      expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
      expect(withdrawButton('req_1')).toBeNull();
    }
  );

  it('names the program in the withdraw label, since every row has the same button text', () => {
    showPending();

    expect(withdrawButton('req_1')?.getAttribute('aria-label')).toBe('Withdraw request to join Kubernetes Contributors');
  });

  it('emits the request id on withdraw rather than removing the row itself', () => {
    showPending();
    const withdrawn: string[] = [];
    fixture.componentInstance.withdraw.subscribe((id) => withdrawn.push(id));

    withdrawButton('req_1')?.click();

    expect(withdrawn).toEqual(['req_1']);
    // The parent owns the list: it decides what a withdraw does and re-reads it.
    expect(element().querySelector('[data-testid="mentorship-mentor-request-row-req_1"]')).not.toBeNull();
  });

  it('marks the row being withdrawn as loading and disables every Withdraw meanwhile', () => {
    fixture.componentRef.setInput('requests', [
      { ...request, status: 'pending' },
      { id: 'req_2', programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'pending' },
    ]);
    fixture.componentRef.setInput('withdrawingId', 'req_1');
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-withdraw-req_1"]')?.getAttribute('data-loading')).toBe('true');
    expect(withdrawButton('req_1')?.disabled).toBe(true);
    expect(withdrawButton('req_2')?.disabled).toBe(true);
  });

  it('shows a failed read with Retry in place of the table, and disables the select, rather than an empty list', () => {
    const control = fixture.componentInstance['pickerForm'].controls.programId;
    let retries = 0;
    fixture.componentInstance.retry.subscribe(() => retries++);

    fixture.componentRef.setInput('requests', []);
    fixture.componentRef.setInput('requestsFailed', true);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-requests-failed"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();
    expect(control.disabled).toBe(true);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-requests-retry"] button')?.click();
    expect(retries).toBe(1);

    fixture.componentRef.setInput('requestsFailed', false);
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentorship-mentor-requests-failed"]')).toBeNull();
    expect(control.disabled).toBe(false);
  });

  it('hides the request table entirely when nothing has been requested', () => {
    fixture.componentRef.setInput('requests', []);
    fixture.detectChanges();

    expect(element().querySelector('table')).toBeNull();
  });

  it('renders the card wrapper with border and padding when bordered is true (default)', () => {
    const wrapper = element().querySelector('[data-testid="mentorship-mentor-programs"]');
    expect(wrapper?.classList.contains('rounded-2xl')).toBe(true);
    expect(wrapper?.classList.contains('border')).toBe(true);
    expect(wrapper?.classList.contains('border-gray-200')).toBe(true);
    expect(wrapper?.classList.contains('bg-white')).toBe(true);
  });

  it('strips the card wrapper when bordered is false, used inside drawers', () => {
    fixture.componentRef.setInput('bordered', false);
    fixture.detectChanges();

    const wrapper = element().querySelector('[data-testid="mentorship-mentor-programs"]');
    expect(wrapper?.classList.contains('rounded-2xl')).toBe(false);
    expect(wrapper?.classList.contains('border')).toBe(false);
    expect(wrapper?.classList.contains('border-gray-200')).toBe(false);
    expect(wrapper?.classList.contains('bg-white')).toBe(false);
  });
});
