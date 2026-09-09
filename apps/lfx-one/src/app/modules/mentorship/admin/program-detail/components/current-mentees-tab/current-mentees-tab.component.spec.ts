// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipNoteRequest, MentorshipProgramMentee } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

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

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [provideNoopAnimations(), MessageService],
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

  it('narrows the rows to the chosen status, and back again when cleared', () => {
    const component = fixture.componentInstance;

    component['form'].controls.status.setValue('graduated');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['mnt_2']);

    component['form'].controls.status.setValue('accepted');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['mnt_1']);

    component['form'].controls.status.reset(null);
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['mnt_1', 'mnt_2']);
  });

  it('returns to the first page when a filter narrows the list', () => {
    const component = fixture.componentInstance;
    component['first'].set(10);

    component['form'].controls.search.setValue('Priya');
    fixture.detectChanges();

    // Otherwise the table stays on an offset the filtered list no longer reaches.
    expect(component['first']()).toBe(0);
  });

  it('asks the parent to open the note rather than owning the dialog itself', () => {
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-note-mnt_2"]')?.click();

    expect(requests).toEqual([{ personId: 'mnt_2', personName: 'Priya Shah' }]);
  });

  it('renders the parent note draft in place of the note the row arrived with', () => {
    fixture.componentRef.setInput('mentees', [mentee({ note: 'from the server' }), mentee({ id: 'mnt_2', name: 'Priya Shah', status: 'graduated' })]);
    fixture.componentRef.setInput('noteDrafts', { mnt_2: 'a saved note' });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="mentorship-mentee-note-mnt_2"]')?.textContent?.trim()).toBe('a saved note');
    // A row without a draft keeps whatever it arrived with, rather than picking up a neighbour's.
    expect(element.querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')?.textContent?.trim()).toBe('from the server');
  });
});
