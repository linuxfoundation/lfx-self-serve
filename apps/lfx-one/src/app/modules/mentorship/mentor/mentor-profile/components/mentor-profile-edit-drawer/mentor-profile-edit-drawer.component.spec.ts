// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, output, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorProfileDetails,
  MentorshipMentorProfileUpdateRequest,
  MentorshipMentorProfileUpdateResponse,
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
import { MentorProfileSaveService } from '../../../../services/mentor-profile-save.service';
import { MentorProgramRequestService } from '../../../../services/mentor-program-request.service';
import { MentorRequestWithdrawService } from '../../../../services/mentor-request-withdraw.service';
import { MentorProgramsSectionComponent } from '../../../mentor-register/components/mentor-programs-section/mentor-programs-section.component';
import { DrawerModule } from 'primeng/drawer';
import { MentorProfileEditDrawerComponent } from './mentor-profile-edit-drawer.component';
import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

const PROFILE: MentorshipMentorProfileDetails = {
  aboutMe: '<p>Hello world</p>',
  skills: ['Kubernetes', 'Angular'],
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
  readonly closable = input(true);
  readonly dismissible = input(true);
  readonly closeOnEscape = input(true);
  readonly styleClass = input('');
}

@Component({ selector: 'p-confirmDialog', template: '' })
class StubConfirmDialogComponent {}

@Component({ selector: 'lfx-mentorship-mentor-programs-section', template: '' })
class StubProgramsSectionComponent {
  readonly bordered = input(true);
  readonly requests = input<MentorshipMentorProgramRequest[]>([]);
  readonly requesting = input(false);
  readonly withdrawingId = input<string | null>(null);
  readonly invitedProgramIds = input<string[]>([]);
  readonly requestsLoading = input(false);
  readonly requestsFailed = input(false);
  readonly add = output<MentorshipMentorOpenProgram>();
  readonly withdraw = output<string>();
  readonly retry = output<void>();
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
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly onClick = output<MouseEvent>();
}
/* eslint-enable @angular-eslint/component-selector */

describe('MentorProfileEditDrawerComponent', () => {
  let fixture: ComponentFixture<MentorProfileEditDrawerComponent>;
  let comp: MentorProfileEditDrawerComponent;
  let drawer: MentorProfileEditDrawerService;
  let messageAdd: ReturnType<typeof vi.fn>;
  let revision: ReturnType<typeof signal<number>>;
  let getMentorRequests: ReturnType<typeof vi.fn<() => Observable<MentorshipMentorProgramRequestsResponse>>>;
  let request: ReturnType<typeof vi.fn<(program: MentorshipMentorOpenProgram) => Observable<boolean>>>;
  let confirmWithdraw: ReturnType<typeof vi.fn>;
  let clearMentorCaches: ReturnType<typeof vi.fn>;
  let withdrawingId: ReturnType<typeof signal<string | null>>;
  let saving: ReturnType<typeof signal<boolean>>;
  let save: ReturnType<typeof vi.fn<(body: MentorshipMentorProfileUpdateRequest) => Observable<MentorshipMentorProfileUpdateResponse>>>;
  let saveErrorMessage: ReturnType<typeof vi.fn<(err: unknown) => string>>;

  const SAVED: MentorshipMentorProfileUpdateResponse = { profile: { ...PROFILE, aboutMe: '<p>Updated</p>' } };

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
    getMentorRequests = vi.fn(() => of({ data: REQUESTS, invitedProgramIds: [] }));
    request = vi.fn(() => of(true));
    confirmWithdraw = vi.fn();
    clearMentorCaches = vi.fn();
    withdrawingId = signal<string | null>(null);
    saving = signal(false);
    save = vi.fn(() => of(SAVED));
    saveErrorMessage = vi.fn(() => 'Could not save.');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MentorProfileEditDrawerComponent],
      providers: [
        {
          provide: MentorshipMentorService,
          useValue: { getMentorRequests, clearMentorCaches, mentorRequestsRevision: revision.asReadonly() },
        },
        { provide: MentorProgramRequestService, useValue: { request } },
        { provide: MentorProfileSaveService, useValue: { save, saving: saving.asReadonly(), errorMessage: saveErrorMessage } },
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

  it('sends only the changed fields, emits the saved profile and closes the drawer', () => {
    const emitted: MentorshipMentorProfileUpdateResponse[] = [];
    comp.saved.subscribe((response) => emitted.push(response));
    comp['form'].controls.introduction.setValue('<p>Updated</p>');

    comp['onSave']();

    expect(save).toHaveBeenCalledWith({ introduction: '<p>Updated</p>' });
    expect(emitted).toEqual([SAVED]);
    expect(drawer.isOpen()).toBe(false);
  });

  it('sends the skills when only they change', () => {
    comp['form'].controls.skills.setValue(['Kubernetes']);

    comp['onSave']();

    expect(save).toHaveBeenCalledWith({ skills: ['Kubernetes'] });
  });

  it('closes without a request when nothing changed', () => {
    comp['onSave']();

    expect(save).not.toHaveBeenCalled();
    expect(drawer.isOpen()).toBe(false);
  });

  it('shows the field error and sends nothing when a changed field is invalid', async () => {
    comp['form'].controls.skills.setValue([]);

    comp['onSave']();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(drawer.isOpen()).toBe(true);
    expect(comp['errors']().skills).toBeTruthy();
    const picker = fixture.debugElement.query(By.directive(StubSkillsPickerComponent)).componentInstance as StubSkillsPickerComponent;
    expect(picker.error()).toBe(comp['errors']().skills);

    // The error follows the edit once it is shown.
    comp['form'].controls.skills.setValue(['Angular']);
    await settle();
    expect(comp['errors']().skills).toBeUndefined();
  });

  it('shows the introduction error inline when the changed introduction is empty', async () => {
    comp['form'].controls.introduction.setValue('');

    comp['onSave']();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(element().querySelector('[data-testid="mentor-profile-edit-introduction-error"]')).toBeTruthy();
  });

  it('keeps the drawer open with the input and shows the failure inline, cleared by the next edit', async () => {
    save.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    comp['form'].controls.introduction.setValue('<p>Updated</p>');

    comp['onSave']();
    await settle();

    expect(drawer.isOpen()).toBe(true);
    expect(comp['form'].getRawValue().introduction).toBe('<p>Updated</p>');
    expect(element().querySelector('[data-testid="mentor-profile-edit-drawer-error"]')?.textContent?.trim()).toBe('Could not save.');

    comp['form'].controls.introduction.setValue('<p>Updated again</p>');
    await settle();
    expect(element().querySelector('[data-testid="mentor-profile-edit-drawer-error"]')).toBeNull();
  });

  it('blocks save, cancel and close while a save is in flight, and makes the fields inert', async () => {
    saving.set(true);
    await settle();
    comp['form'].controls.introduction.setValue('<p>Updated</p>');

    comp['onSave']();
    comp['onCancel']();
    comp['onVisibleChange'](false);

    expect(save).not.toHaveBeenCalled();
    expect(drawer.isOpen()).toBe(true);
    expect(element().querySelector('[data-testid="mentor-profile-edit-drawer-fields"]')?.hasAttribute('inert')).toBe(true);
    const drawerStub = fixture.debugElement.query(By.directive(StubDrawerComponent)).componentInstance as StubDrawerComponent;
    expect(drawerStub.closable()).toBe(false);
    expect(drawerStub.dismissible()).toBe(false);
    expect(drawerStub.closeOnEscape()).toBe(false);
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

  it('mounts the programs section on the first open only, and keeps it after a close', async () => {
    drawer.close();
    fixture = TestBed.createComponent(MentorProfileEditDrawerComponent);
    await settle();
    expect(fixture.debugElement.query(By.directive(StubProgramsSectionComponent))).toBeNull();

    drawer.open(PROFILE);
    await settle();
    expect(fixture.debugElement.query(By.directive(StubProgramsSectionComponent))).not.toBeNull();

    drawer.close();
    await settle();
    expect(fixture.debugElement.query(By.directive(StubProgramsSectionComponent))).not.toBeNull();
  });

  it('renders all four content sections', () => {
    expect(element().querySelector('lfx-mentorship-mentor-programs-section')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentor-profile-edit-introduction"]')).toBeTruthy();
    expect(element().querySelector('[data-testid="mentor-profile-edit-skills"]')).toBeTruthy();
    expect(element().querySelector('lfx-mentorship-resume-section')).toBeTruthy();
  });

  // --- Program requests ---

  it('passes the mentor requests to the programs section, which reads the programs itself', () => {
    expect(section().requests()).toEqual(REQUESTS);
    expect(section().requestsLoading()).toBe(false);
    expect(section().requestsFailed()).toBe(false);
  });

  it('tells the section the requests are loading while an open reads them, so its picker waits', async () => {
    const pending = new Subject<MentorshipMentorProgramRequestsResponse>();
    getMentorRequests.mockReturnValueOnce(pending);
    drawer.open({ ...PROFILE, aboutMe: 'Reopen' });
    await settle();

    expect(section().requestsLoading()).toBe(true);

    pending.next({ data: REQUESTS, invitedProgramIds: [] });
    pending.complete();
    await settle();

    expect(section().requestsLoading()).toBe(false);
  });

  it('passes the invited programs to the section so the picker can leave them out', async () => {
    getMentorRequests.mockReturnValue(of({ data: REQUESTS, invitedProgramIds: ['p2'] }));
    drawer.open({ ...PROFILE, aboutMe: 'Reopen' });
    await settle();

    expect(section().invitedProgramIds()).toEqual(['p2']);
  });

  it('marks the requests failed, not empty, when they cannot be read', async () => {
    getMentorRequests.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
    drawer.open({ ...PROFILE, aboutMe: 'Reopen' });
    await settle();

    expect(section().requestsFailed()).toBe(true);
    expect(section().requests()).toEqual([]);
    expect(section().requestsLoading()).toBe(false);
  });

  it('clears the mentor caches on Retry so the requests are read again', () => {
    section().retry.emit();

    expect(clearMentorCaches).toHaveBeenCalledTimes(1);
  });

  it('re-reads the requests when a write bumps the revision, keeping the rows meanwhile', async () => {
    const pending = new Subject<MentorshipMentorProgramRequestsResponse>();
    getMentorRequests.mockReturnValueOnce(pending);
    const callsBefore = getMentorRequests.mock.calls.length;

    revision.update((value) => value + 1);
    await settle();

    expect(getMentorRequests.mock.calls.length).toBe(callsBefore + 1);
    expect(section().requests()).toEqual(REQUESTS);
    expect(section().requestsLoading()).toBe(false);

    const updated: MentorshipMentorProgramRequest[] = [{ ...REQUESTS[0], status: 'withdrawn' }];
    pending.next({ data: updated, invitedProgramIds: [] });
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
