// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipNoteRequest, MentorshipProgramMentee, MentorshipTaskDialogAssignee, MentorshipTaskFormValue } from '@lfx-one/shared/interfaces';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
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
    tasks: [
      {
        id: 'tsk_1',
        name: 'Resume',
        description: 'Upload the most recent version of your resume.',
        status: 'submitted',
        prerequisite: false,
        createdOn: '2026-07-01',
        updatedOn: '2026-08-15',
        hasSubmission: true,
      },
      {
        id: 'tsk_2',
        name: 'Midterm Report',
        description: 'Summarize progress on your mentorship project goals.',
        status: 'pending',
        prerequisite: true,
        createdOn: '2026-08-01',
        updatedOn: '2026-08-01',
      },
    ],
    ...overrides,
  });

  let fixture: ComponentFixture<CurrentMenteesTabComponent>;
  let openCreate: ReturnType<typeof vi.fn>;
  let openEdit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openCreate = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    openEdit = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        // Stub the dialog service so the spec never touches PrimeNG's DialogService,
        // and so we can assert on the exact assignee payload the tab hands off.
        { provide: MentorshipTaskDialogService, useValue: { openCreate, openEdit } },
      ],
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

  it('names the real <table> element via aria-label', () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('table')?.getAttribute('aria-label')).toBe('Current mentees');
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

  it('expands assigned tasks when View Tasks is clicked and hides prerequisite tasks by default', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="mentorship-mentee-tasks-expanded-mnt_1"]')).toBeNull();

    element.querySelector<HTMLElement>('[data-testid="mentorship-mentee-view-tasks-mnt_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="mentorship-mentee-tasks-expanded-mnt_1"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')?.textContent).toContain('Resume');
    expect(element.querySelector('[data-testid="mentorship-applicant-task-row-tsk_2"]')).toBeNull();
  });

  it("opens the task-form dialog with just the row's mentee when Create Task is clicked", () => {
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('[data-testid="mentorship-mentee-create-task-mnt_2"]')?.querySelector<HTMLButtonElement>('button')?.click();

    expect(openCreate).toHaveBeenCalledTimes(1);
    const arg = openCreate.mock.calls[0][0] as MentorshipTaskDialogAssignee;
    expect(arg.id).toBe('mnt_2');
    expect(arg.name).toBe('Priya Shah');
  });

  it('leaves the toast silent when the dialog is dismissed without a value', () => {
    // Default stub returns `of(undefined)` — dismissal path. No toast should fire.
    const messageService = TestBed.inject(MessageService);
    const addSpy = vi.spyOn(messageService, 'add');

    fixture.componentInstance['onCreateTask']({ id: 'mnt_1', name: 'Alex Rivera', email: 'a@x' } as MentorshipProgramMentee);

    expect(addSpy).not.toHaveBeenCalled();
  });

  it('routes the created task to the coming-soon toast until the write endpoint lands', () => {
    // Override the stub with a resolved form value so we exercise the success path.
    openCreate.mockReturnValue(
      of({
        taskId: undefined,
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output.',
        requiresFileSubmission: false,
        assignedMenteeIds: ['mnt_1'],
      } satisfies MentorshipTaskFormValue)
    );
    const messageService = TestBed.inject(MessageService);
    const addSpy = vi.spyOn(messageService, 'add');

    fixture.componentInstance['onCreateTask']({ id: 'mnt_1', name: 'Alex Rivera', email: 'a@x' } as MentorshipProgramMentee);

    expect(addSpy).toHaveBeenCalledTimes(1);
    // `MessageService.add` signature is `add(message: ToastMessageOptions): void` — narrow for `.summary`.
    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Create task "Submit ingestion benchmark report" for Alex Rivera');
  });
});
