// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, output, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_COMING_SOON_TOAST_LIFE, MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL } from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentorProfileDetails,
  MentorshipMentorProgramRequest,
  MentorshipMentorProgramRequestsResponse,
} from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { RichEditorComponent } from '../../../../../../shared/components/rich-editor/rich-editor.component';
import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorProgramRequestService } from '../../../../services/mentor-program-request.service';
import { MentorRequestWithdrawService } from '../../../../services/mentor-request-withdraw.service';
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

const PROGRAMS: MentorshipMentorOpenProgram[] = [
  { id: 'p1', name: 'GridFlow' },
  { id: 'p2', name: 'Apicurio' },
];

const REQUESTS: MentorshipMentorProgramRequest[] = [{ id: 'app-1', programId: 'p1', programName: 'GridFlow', status: 'pending' }];

// --- Lightweight stubs for expensive child components ---

/* eslint-disable @angular-eslint/component-selector */
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

@Component({ selector: 'p-confirmDialog', template: '' })
class StubConfirmDialogComponent {}

@Component({ selector: 'lfx-mentorship-mentor-programs-section', template: '' })
class StubProgramsSectionComponent {
  readonly programs = input<MentorshipMentorOpenProgram[]>([]);
  readonly loading = input(false);
  readonly bordered = input(true);
  readonly requests = input<MentorshipMentorProgramRequest[]>([]);
  readonly requesting = input(false);
  readonly withdrawingId = input<string | null>(null);
  readonly add = output<MentorshipMentorOpenProgram>();
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
/* eslint-enable @angular-eslint/component-selector */

describe('MentorProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MentorProfileEditDrawerComponent>;
  let comp: MentorProfileEditDrawerComponent;
  let drawer: MentorProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;
  let revision: ReturnType<typeof signal<number>>;
  let getOpenPrograms: ReturnType<typeof vi.fn<() => Observable<MentorshipMentorOpenProgramsResponse>>>;
  let getMentorRequests: ReturnType<typeof vi.fn<() => Observable<MentorshipMentorProgramRequestsResponse>>>;
  let request: ReturnType<typeof vi.fn<(program: MentorshipMentorOpenProgram) => Observable<boolean>>>;
  let confirmWithdraw: ReturnType<typeof vi.fn>;
  let withdrawingId: ReturnType<typeof signal<string | null>>;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function section(): StubProgramsSectionComponent {
    return fixture.debugElement.query(By.directive(StubProgramsSectionComponent)).componentInstance as StubProgramsSectionComponent;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    messageAdd = vi.fn();
    drawer = new MentorProfileEditDrawerService();
    revision = signal(0);
    getOpenPrograms = vi.fn(() => of({ data: PROGRAMS }));
    getMentorRequests = vi.fn(() => of({ data: REQUESTS }));
    request = vi.fn(() => of(true));
    confirmWithdraw = vi.fn();
    withdrawingId = signal<string | null>(null);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MentorProfileEditDrawerComponent],
      providers: [
        { provide: MentorshipMentorService, useValue: { getOpenPrograms, getMentorRequests, mentorRequestsRevision: revision.asReadonly() } },
        { provide: MentorProgramRequestService, useValue: { request } },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: MentorProfileEditDrawerService, useValue: drawer },
      ],
    })
      .overrideComponent(MentorProfileEditDrawerComponent, {
        remove: {
          imports: [
            ConfirmDialogModule,
            DrawerModule,
            ButtonComponent,
            RichEditorComponent,
            MentorProgramsSectionComponent,
            SkillsPickerComponent,
            ResumeSectionComponent,
          ],
        },
        add: {
          imports: [
            StubConfirmDialogComponent,
            StubDrawerComponent,
            StubProgramsSectionComponent,
            StubRichEditorComponent,
            StubSkillsPickerComponent,
            StubResumeSectionComponent,
            StubButtonComponent,
          ],
        },
      })
      // The withdraw service is provided by the drawer itself; its confirm and toasts have their own spec.
      .overrideProvider(MentorRequestWithdrawService, { useValue: { confirmWithdraw, withdrawingId: withdrawingId.asReadonly() } })
      .compileComponents();

    fixture = TestBed.createComponent(MentorProfileEditDrawerComponent);
    comp = fixture.componentInstance;
    drawer.open(PROFILE);
    await settle();
  });

  // --- Form seeding ---

  it('seeds the form from the profile context on open', () => {
    const raw = comp['form'].getRawValue();

    expect(raw.introduction).toBe(PROFILE.aboutMe);
    expect(raw.skills).toEqual(PROFILE.skills);
    expect(raw.resumeFileName).toBe(PROFILE.resumeFileName);
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

  it('passes the open programs and the mentor requests to the programs section', () => {
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
    expect(section().programs()).toEqual(PROGRAMS);
    expect(section().requests()).toEqual(REQUESTS);
    expect(section().loading()).toBe(false);
  });

  it('shows no rows, not a stuck loading state, when the requests cannot be read', async () => {
    getMentorRequests.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
    drawer.open({ ...PROFILE, aboutMe: 'Reopen' });
    await settle();

    expect(section().requests()).toEqual([]);
    expect(section().loading()).toBe(false);
  });

  it('re-reads the requests when a write bumps the revision, keeping the rows meanwhile', async () => {
    const pending = new Subject<MentorshipMentorProgramRequestsResponse>();
    getMentorRequests.mockReturnValueOnce(pending);
    const callsBefore = getMentorRequests.mock.calls.length;

    revision.update((value) => value + 1);
    await settle();

    expect(getMentorRequests.mock.calls.length).toBe(callsBefore + 1);
    expect(section().requests()).toEqual(REQUESTS);
    expect(section().loading()).toBe(false);

    const updated: MentorshipMentorProgramRequest[] = [{ ...REQUESTS[0], status: 'withdrawn' }];
    pending.next({ data: updated });
    pending.complete();
    await settle();

    expect(section().requests()).toEqual(updated);
  });

  it('sends a picked program right away and disables the picker until it settles', async () => {
    const pending = new Subject<boolean>();
    request.mockReturnValueOnce(pending);

    section().add.emit(PROGRAMS[1]);
    await settle();

    expect(request).toHaveBeenCalledWith(PROGRAMS[1]);
    expect(section().requesting()).toBe(true);

    // A second pick while the first is in flight is ignored.
    comp['onAddProgram'](PROGRAMS[0]);
    expect(request).toHaveBeenCalledTimes(1);

    pending.next(true);
    pending.complete();
    await settle();

    expect(section().requesting()).toBe(false);
  });

  it('hands Withdraw to the withdraw service and passes its busy row to the section', async () => {
    section().withdraw.emit('app-1');

    expect(confirmWithdraw).toHaveBeenCalledWith('app-1');

    withdrawingId.set('app-1');
    await settle();

    expect(section().withdrawingId()).toBe('app-1');
  });
});
