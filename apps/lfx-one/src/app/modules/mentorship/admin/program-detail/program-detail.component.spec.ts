// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipProgramDetail } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramDetailComponent } from './program-detail.component';

describe('ProgramDetailComponent', () => {
  const detail = (status: MentorshipProgramDetail['program']['status'] = 'open'): MentorshipProgramDetail => ({
    program: {
      id: 'mp_gridflow_fall26',
      slug: 'gridflow-time-series-ingestion-pipeline',
      name: 'GridFlow: Time-Series Ingestion Pipeline',
      projectName: 'LF Energy',
      term: 'Fall 2026',
      status,
      stats: { mentors: 2, mentees: 1, graduated: 0 },
      createdOn: '2026-05-01',
      updatedOn: '2026-07-02',
    },
    mentees: [{ id: 'mnt_1', name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'accepted', termName: 'Fall 2026' }],
    applicants: [
      {
        id: 'app_1',
        name: 'Ifeoma Adeyemi',
        email: 'ifeoma.adeyemi@example.com',
        status: 'pending',
        termName: 'Fall 2026',
        createdOn: '2026-06-28',
        updatedOn: '2026-07-02',
      },
    ],
    mentors: [],
    terms: [],
    tabCounts: { mentees: 1, applicants: 1, mentors: 0, terms: 0 },
  });

  let fixture: ComponentFixture<ProgramDetailComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  // Takes the observable rather than the value: a dismissed dialog closes with `undefined`,
  // and passing that through a defaulted parameter would silently restore the default.
  const buildWith = (onClose: Observable<string | undefined>): void => {
    dialogOpen = vi.fn(() => ({ onClose }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        {
          provide: MentorshipService,
          // The Mentors tab loads its invite picker on construction, and the persistence
          // test renders that tab to prove notes survive one being destroyed.
          useValue: { getProgram: () => of(detail()), getInvitableUsers: () => of(EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_gridflow_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(ProgramDetailComponent);
    fixture.detectChanges();
  };

  const build = (): void => buildWith(of('a saved note'));

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const showTab = (tab: string): void => {
    fixture.componentInstance['activeTab'].set(tab as never);
    fixture.detectChanges();
  };

  beforeEach(() => build());

  it('keeps a reviewer note when the admin leaves the tab and comes back', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-note-mnt_1"]')?.click();
    fixture.detectChanges();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(element().querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')?.textContent?.trim()).toBe('a saved note');

    // The tab panel is an `@switch`, so this destroys the tab component outright.
    showTab('mentors');
    showTab('mentees');

    expect(element().querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')?.textContent?.trim()).toBe('a saved note');
  });

  it('holds notes per person, across both tabs that have them', () => {
    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-note-mnt_1"]')?.click();
    fixture.detectChanges();

    showTab('applicants');
    expect(element().querySelector('[data-testid="mentorship-applicant-note-app_1"]')?.textContent?.trim()).toBe('Add note');

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-applicant-note-app_1"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['noteDrafts']()).toEqual({ mnt_1: 'a saved note', app_1: 'a saved note' });
  });

  it('leaves the note untouched when the dialog is dismissed', () => {
    buildWith(of(undefined));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-note-mnt_1"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['noteDrafts']()).toEqual({});
    expect(element().querySelector('[data-testid="mentorship-mentee-note-mnt_1"]')?.textContent?.trim()).toBe('Add note');
  });
});
