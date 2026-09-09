// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { PastMenteesTabComponent } from './past-mentees-tab.component';

describe('PastMenteesTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramMentee> = {}): MentorshipProgramMentee => ({
    id: 'mnt_1',
    name: 'Dilan Ferreira',
    email: 'dilan.ferreira@example.com',
    status: 'graduated',
    termName: 'Summer 2026',
    ...overrides,
  });

  let fixture: ComponentFixture<PastMenteesTabComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PastMenteesTabComponent],
      providers: [provideNoopAnimations(), MessageService],
    });

    fixture = TestBed.createComponent(PastMenteesTabComponent);
    fixture.componentRef.setInput('mentees', [
      mentee(),
      mentee({ id: 'mnt_2', name: 'Omar Haddad', status: 'withdrawn' }),
      mentee({ id: 'mnt_3', name: 'Ines Duarte', status: 'declined', termName: 'Spring 2026' }),
    ]);
    fixture.detectChanges();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('renders Mentee, Status, and Term — and none of the current-mentee columns', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentee', 'Status', 'Term']);
    expect(headers).not.toContain('Tasks');
    expect(headers).not.toContain('Create Task');
    expect(headers).not.toContain('Actions');
  });

  it('shows the term each mentee took part in', () => {
    const row = element().querySelector('[data-testid="mentorship-past-mentee-row-mnt_3"]');

    expect(row?.textContent).toContain('Spring 2026');
    expect(row?.textContent).toContain('Declined');
  });

  it('offers no note, task, or row-action controls', () => {
    expect(element().querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-tasks-mnt_1"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-create-task-mnt_1"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-actions-mnt_1"]')).toBeNull();
  });

  it('filters by both status and term', () => {
    const component = fixture.componentInstance;

    expect(component['statusOptions'].map((option) => option.label)).toEqual(['All statuses', 'Withdrawn', 'Declined', 'Graduated']);
    expect(component['termOptions']().map((option) => option.label)).toEqual(['All terms', 'Summer 2026', 'Spring 2026']);

    component['form'].controls.status.setValue('withdrawn');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['mnt_2']);

    component['form'].controls.status.reset(null);
    component['form'].controls.term.setValue('Spring 2026');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['mnt_3']);
  });
});
