// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_COMING_SOON_TOAST_LIFE, MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails, MentorshipMentorProgramRequest, MentorshipProgram } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { RichEditorComponent } from '../../../../../../shared/components/rich-editor/rich-editor.component';
import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorProgramsSectionComponent } from '../../../mentor-register/components/mentor-programs-section/mentor-programs-section.component';
import { DrawerModule } from 'primeng/drawer';
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

// --- Lightweight stubs for expensive child components ---

@Component({
  selector: 'p-drawer',
  template: '<ng-content /><ng-content select="[pTemplate=header]" />',
})
class StubDrawerComponent {
  readonly visible = input(false);
  readonly position = input('right');
  readonly modal = input(false);
  readonly styleClass = input('');
}

@Component({ selector: 'lfx-mentorship-mentor-programs-section', template: '' })
class StubProgramsSectionComponent {
  readonly programs = input<MentorshipProgram[]>([]);
  readonly loading = input(false);
  readonly bordered = input(true);
  readonly requests = input<MentorshipMentorProgramRequest[]>([]);
  readonly add = output<MentorshipProgram>();
  readonly withdraw = output<string>();
}

@Component({ selector: 'lfx-rich-editor', template: '' })
class StubRichEditorComponent {
  readonly form = input<FormGroup>();
  readonly control = input('');
  readonly placeholder = input('');
  readonly editorStyle = input<Record<string, string>>({});
  readonly ariaLabelledBy = input('');
  readonly dataTest = input('');
}

@Component({ selector: 'lfx-mentorship-skills-picker', template: '' })
class StubSkillsPickerComponent {
  readonly form = input<FormGroup>();
  readonly label = input('');
  readonly idPrefix = input('');
  readonly error = input<string | undefined>(undefined);
}

@Component({ selector: 'lfx-mentorship-resume-section', template: '' })
class StubResumeSectionComponent {
  readonly form = input<FormGroup>();
  readonly intro = input('');
  readonly bordered = input(true);
  readonly idPrefix = input('');
}

@Component({ selector: 'lfx-button', template: '' })
class StubButtonComponent {
  readonly label = input('');
  readonly type = input('');
  readonly variant = input('');
  readonly severity = input('');
  readonly size = input('');
  readonly onClick = output<MouseEvent>();
}

describe('MentorProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MentorProfileEditDrawerComponent>;
  let comp: MentorProfileEditDrawerComponent;
  let drawer: MentorProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    messageAdd = vi.fn();
    drawer = new MentorProfileEditDrawerService();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
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
    })
      .overrideComponent(MentorProfileEditDrawerComponent, {
        remove: {
          imports: [DrawerModule, ButtonComponent, RichEditorComponent, MentorProgramsSectionComponent, SkillsPickerComponent, ResumeSectionComponent],
        },
        add: {
          imports: [
            StubDrawerComponent,
            StubProgramsSectionComponent,
            StubRichEditorComponent,
            StubSkillsPickerComponent,
            StubResumeSectionComponent,
            StubButtonComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MentorProfileEditDrawerComponent);
    comp = fixture.componentInstance;
    drawer.open(PROFILE);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  // --- Form seeding ---

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

  // --- Save / Cancel ---

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

  // --- Drawer visibility and template rendering ---

  it('closes the drawer on visibleChange(false)', () => {
    comp['onVisibleChange'](false);

    expect(drawer.isOpen()).toBe(false);
  });

  it('renders the drawer body when the drawer is open', () => {
    expect(element().querySelector('[data-testid="mentor-profile-edit-drawer-body"]')).toBeTruthy();
  });

  it('renders horizontal rule dividers between sections', () => {
    const body = element().querySelector('[data-testid="mentor-profile-edit-drawer-body"]');
    const hrs = body?.querySelectorAll('hr.border-gray-200');

    expect(hrs?.length).toBe(3);
  });

  it('renders the save and cancel action buttons', () => {
    const actions = element().querySelector('[data-testid="mentor-profile-edit-drawer-actions"]');

    expect(actions?.querySelector('[data-testid="mentor-profile-edit-drawer-save"]')).toBeTruthy();
    expect(actions?.querySelector('[data-testid="mentor-profile-edit-drawer-cancel"]')).toBeTruthy();
  });

  it('renders all four content sections', () => {
    expect(element().querySelector('lfx-mentorship-mentor-programs-section')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentor-profile-edit-introduction"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentor-profile-edit-skills"]')).toBeTruthy();
    expect(element().querySelector('lfx-mentorship-resume-section')).toBeTruthy();
  });

  // --- Program requests ---

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
