// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_COMING_SOON_TOAST_LIFE, MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails, MentorshipProgram } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProfileEditDrawerComponent } from './mentor-profile-edit-drawer.component';
import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

const PROFILE: MentorshipMentorProfileDetails = {
  aboutMe: '<p>Hello world</p>',
  skills: ['Go', 'Kubernetes'],
  resumeFileName: 'resume.pdf',
  resumeUrl: 'https://example.com/resume.pdf',
};

const PROGRAMS: MentorshipProgram[] = [
  {
    id: 'p1',
    slug: 'gridflow',
    name: 'GridFlow',
    projectName: 'LF Energy',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 2, mentees: 5, graduated: 0 },
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-09-01T00:00:00Z',
  },
  {
    id: 'p2',
    slug: 'apicurio',
    name: 'Apicurio',
    projectName: 'CNCF',
    term: 'Fall 2026',
    status: 'open',
    stats: { mentors: 1, mentees: 3, graduated: 0 },
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-09-01T00:00:00Z',
  },
];

describe('MentorProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MentorProfileEditDrawerComponent>;
  let comp: MentorProfileEditDrawerComponent;
  let drawer: MentorProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    messageAdd = vi.fn();
    drawer = new MentorProfileEditDrawerService();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProfileEditDrawerComponent],
      providers: [
        {
          provide: MentorshipService,
          useValue: {
            getPrograms: vi.fn(() => of({ data: PROGRAMS, total: PROGRAMS.length })),
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: MentorProfileEditDrawerService, useValue: drawer },
      ],
    });
    TestBed.overrideComponent(MentorProfileEditDrawerComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(MentorProfileEditDrawerComponent);
    comp = fixture.componentInstance;
    drawer.open(PROFILE);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('seeds the form from the profile context on open', () => {
    const raw = comp['form'].getRawValue();

    expect(raw.introduction).toBe(PROFILE.aboutMe);
    expect(raw.skills).toEqual(PROFILE.skills);
    expect(raw.resumeFileName).toBe(PROFILE.resumeFileName);
  });

  it('resets program requests on each open', () => {
    comp['onAddProgram'](PROGRAMS[0]);
    expect(comp['requests']().length).toBe(1);

    drawer.open({ ...PROFILE, aboutMe: 'Reopen' });
    fixture.detectChanges();

    expect(comp['requests']().length).toBe(0);
  });

  it('fires the coming-soon toast and closes the drawer on save', () => {
    comp['onSave']();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
        detail: MENTORSHIP_COMING_SOON_DETAIL,
        life: MENTORSHIP_COMING_SOON_TOAST_LIFE,
      })
    );
    expect(drawer.isOpen()).toBe(false);
  });

  it('closes the drawer on cancel without a toast', () => {
    comp['onCancel']();

    expect(drawer.isOpen()).toBe(false);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('closes the drawer on visibleChange(false)', () => {
    comp['onVisibleChange'](false);

    expect(drawer.isOpen()).toBe(false);
  });

  it('adds a program request and prevents duplicates', () => {
    comp['onAddProgram'](PROGRAMS[0]);
    comp['onAddProgram'](PROGRAMS[0]);

    expect(comp['requests']().length).toBe(1);
    expect(comp['requests']()[0].programId).toBe('p1');
  });

  it('withdraws a program request by id', () => {
    comp['onAddProgram'](PROGRAMS[0]);
    comp['onAddProgram'](PROGRAMS[1]);

    comp['onWithdraw']('req_p1');

    expect(comp['requests']().length).toBe(1);
    expect(comp['requests']()[0].programId).toBe('p2');
  });
});
