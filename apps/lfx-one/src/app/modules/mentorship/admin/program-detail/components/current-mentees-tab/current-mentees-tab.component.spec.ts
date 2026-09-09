// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentMenteesTabComponent } from './current-mentees-tab.component';

describe('CurrentMenteesTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramMentee> = {}): MentorshipProgramMentee => ({
    id: 'mnt_1',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    status: 'accepted',
    termName: 'Fall 2026',
    tasksSubmitted: 7,
    tasksTotal: 12,
    ...overrides,
  });

  let fixture: ComponentFixture<CurrentMenteesTabComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dialogOpen = vi.fn(() => ({ onClose: of('a saved note') }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [provideNoopAnimations(), MessageService, { provide: DialogService, useValue: { open: dialogOpen } }],
    });

    fixture = TestBed.createComponent(CurrentMenteesTabComponent);
    fixture.componentRef.setInput('mentees', [mentee(), mentee({ id: 'mnt_2', name: 'Priya Shah', status: 'graduated' })]);
    fixture.detectChanges();
  });

  const headerLabels = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

  it('renders the columns with Actions last', () => {
    expect(headerLabels()).toEqual(['Mentee', 'Status', 'Tasks', 'Create Task', 'Actions']);
  });

  it('renders a row per mentee with its task progress', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="mentorship-mentee-row-mnt_1"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="mentorship-mentee-tasks-mnt_1"]')?.textContent?.trim()).toBe('7 of 12 submitted');
  });

  it('offers only the two statuses this tab lists, and no term filter', () => {
    const element = fixture.nativeElement as HTMLElement;

    // The LFX form wrappers project `dataTest` as `data-test`, not `data-testid`.
    expect(element.querySelector('[data-test="mentorship-mentees-status"]')).toBeTruthy();
    expect(element.querySelector('[data-test="mentorship-mentees-term"]')).toBeNull();
    expect(fixture.componentInstance['statusOptions'].map((option) => option.label)).toEqual(['All statuses', 'Accepted', 'Graduated']);
  });

  it('stores the note returned by the dialog against the row it was opened for', () => {
    const element = fixture.nativeElement as HTMLElement;
    const noteButton = element.querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-note-mnt_2"]');

    expect(noteButton?.textContent?.trim()).toBe('Add note');

    noteButton?.click();
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(element.querySelector('[data-testid="mentorship-mentee-note-mnt_2"]')?.textContent?.trim()).toBe('a saved note');
    // The note must land on the row it was opened for, not leak across rows.
    expect(element.querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')?.textContent?.trim()).toBe('Add note');
  });
});
