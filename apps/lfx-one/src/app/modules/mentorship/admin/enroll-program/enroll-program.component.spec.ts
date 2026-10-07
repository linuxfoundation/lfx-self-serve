// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_FORM_INCOMPLETE,
  MENTORSHIP_ENROLL_LEAVE_LOGO_MISSING_CONFIRM,
  MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED,
  MENTORSHIP_ENROLL_LOGO_TOO_LARGE,
  MENTORSHIP_ENROLL_LOGO_TYPE_ERROR,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_ENROLL_PROJECT_REQUIRED,
  MENTORSHIP_ENROLL_SUBMIT_FAILED,
  MENTORSHIP_ENROLL_SUBMIT_SUCCESS,
  MENTORSHIP_ENROLL_UPLOADS_UNAVAILABLE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiLookupStatus,
  MentorshipEnrollFieldErrors,
  MentorshipEnrollProgramRef,
  MentorshipEnrollStep,
  MentorshipLfProject,
  MentorshipNameLookupStatus,
} from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnrollDetailsStepComponent } from './components/enroll-details-step/enroll-details-step.component';
import { EnrollPrerequisitesStepComponent } from './components/enroll-prerequisites-step/enroll-prerequisites-step.component';
import { EnrollSetupStepComponent } from './components/enroll-setup-step/enroll-setup-step.component';
import { EnrollStepperComponent } from './components/enroll-stepper/enroll-stepper.component';
import { EnrollProgramComponent } from './enroll-program.component';

/* ------------------------------------------------------------------ */
/*  Lightweight stubs — prevent child components from rendering their  */
/*  real templates (heavy editor, lookup calls, etc.).                 */
/* ------------------------------------------------------------------ */

@Component({ selector: 'lfx-mentorship-enroll-stepper', template: '' })
class StubStepperComponent {
  public readonly current = input.required<MentorshipEnrollStep>();
}

@Component({ selector: 'lfx-mentorship-enroll-details-step', template: '' })
class StubDetailsStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});
  public readonly project = model<MentorshipLfProject | null>(null);
  public readonly logoFile = model<File | null>(null);
  public readonly ciiLookupStatusChange = output<MentorshipCiiLookupStatus>();
  public readonly nameLookupStatusChange = output<MentorshipNameLookupStatus>();
}

@Component({ selector: 'lfx-mentorship-enroll-setup-step', template: '' })
class StubSetupStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});
}

@Component({ selector: 'lfx-mentorship-enroll-prerequisites-step', template: '' })
class StubPrerequisitesStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});
  public readonly locked = input(false);
}

const PROJECT = { id: 'proj-gridflow', name: 'GridFlow', slug: 'gridflow' } as unknown as MentorshipLfProject;
const PROGRAM: MentorshipEnrollProgramRef = { id: 'prog-1', slug: 'gridflow-mentorship', status: 'pending' };
const LOGO = new File(['png'], 'logo.png', { type: 'image/png' });

const httpError = (status: number, body: unknown = null): HttpErrorResponse => new HttpErrorResponse({ status, error: body });

describe('EnrollProgramComponent', () => {
  let fixture: ComponentFixture<EnrollProgramComponent>;
  let component: EnrollProgramComponent;
  let toast: ReturnType<typeof vi.fn>;
  let router: Router;
  let confirm: ReturnType<typeof vi.fn>;
  let createProgram: ReturnType<typeof vi.fn>;
  let uploadProgramLogo: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): HTMLElement | null => element().querySelector<HTMLElement>(`[data-testid="${id}"]`);

  /** Fills every required field so a spec can isolate a single concern. */
  const fillValidForm = (): void => {
    const defaults = createEmptyMentorshipEnrollForm();
    const prerequisites = defaults.prerequisites.map((p, i) => (i === 0 ? { ...p, required: true } : p));
    component['form'].patchValue({
      name: 'GridFlow Mentorship Program',
      projectId: 'proj-gridflow',
      technologies: ['GO'],
      description: '<p>Build a data pipeline for renewable energy grid analysis.</p>',
      repositoryUrl: 'https://github.com/lfenergy/gridflow',
      logoFileName: 'logo.png',
      skills: ['Go'],
      terms: defaults.terms,
      prerequisites,
      termsAccepted: true,
    });
    component['selectedProject'].set(PROJECT);
    component['logoFile'].set(LOGO);
    fixture.detectChanges();
  };

  /** Sets the wizard directly to the prerequisites step with a valid form. */
  const setPrerequisitesStep = (): void => {
    fillValidForm();
    component['nameLookupStatus'].set('available');
    component['step'].set('prerequisites');
    fixture.detectChanges();
  };

  /** Clicks the real submit button rendered by `ButtonComponent`. */
  const clickSubmit = (): void => {
    const btn = element().querySelector<HTMLButtonElement>('[data-testid="mentorship-enroll-next"] button');
    expect(btn).not.toBeNull();
    btn!.click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();
    createProgram = vi.fn(() => of(PROGRAM));
    uploadProgramLogo = vi.fn(() => of({ logoUrl: 'https://cdn.example/logo.png' }));

    TestBed.configureTestingModule({
      imports: [EnrollProgramComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: { add: toast } },
        { provide: MentorshipAdminService, useValue: { createProgram, uploadProgramLogo } },
      ],
    });

    await TestBed.overrideComponent(EnrollProgramComponent, {
      remove: {
        imports: [EnrollStepperComponent, EnrollDetailsStepComponent, EnrollSetupStepComponent, EnrollPrerequisitesStepComponent],
      },
      add: {
        imports: [StubStepperComponent, StubDetailsStepComponent, StubSetupStepComponent, StubPrerequisitesStepComponent],
      },
    }).compileComponents();

    fixture = TestBed.createComponent(EnrollProgramComponent);
    component = fixture.componentInstance;

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    confirm = vi.fn((options: Confirmation) => {
      options.accept?.();
      return confirmationService;
    });
    confirmationService.confirm = confirm;

    fixture.detectChanges();
  });

  it('renders the enrollment wizard shell', () => {
    expect(byTestId('mentorship-enroll')).not.toBeNull();
    expect(byTestId('mentorship-enroll-title')?.textContent).toContain('Enroll a Program');
  });

  describe('submit', () => {
    it('creates the program, uploads the logo, toasts and navigates to the admin page', () => {
      setPrerequisitesStep();

      clickSubmit();

      expect(createProgram).toHaveBeenCalledTimes(1);
      expect(createProgram.mock.calls[0][0]).toMatchObject({ name: 'GridFlow Mentorship Program', industry: 'GO', termsAccepted: true });
      expect(uploadProgramLogo).toHaveBeenCalledWith(PROGRAM.id, LOGO);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: MENTORSHIP_ENROLL_SUBMIT_SUCCESS }));
      expect(router.navigate).toHaveBeenCalledWith(['/mentorship/admin']);
    });

    it('shows a busy button and ignores a second click while the create is in flight', () => {
      createProgram.mockReturnValue(NEVER);
      setPrerequisitesStep();

      clickSubmit();
      clickSubmit();

      expect(createProgram).toHaveBeenCalledTimes(1);
      expect(component['submitting']()).toBe(true);
      expect(element().querySelector('[data-testid="mentorship-enroll-next"] button')?.hasAttribute('disabled')).toBe(true);
    });

    it('locks the answers but shows no partial-save banner while the first logo upload runs', () => {
      uploadProgramLogo.mockReturnValue(NEVER);
      setPrerequisitesStep();

      clickSubmit();

      expect(component['submitPhase']()).toBe('uploading-logo');
      expect(component['programSaved']()).toBe(true);
      expect(byTestId('mentorship-enroll-partial-save')).toBeNull();
    });

    it('drops a submit still in flight when the wizard is destroyed', () => {
      const upload = new Subject<{ logoUrl: string }>();
      uploadProgramLogo.mockReturnValue(upload);
      setPrerequisitesStep();
      clickSubmit();

      fixture.destroy();
      upload.next({ logoUrl: 'https://cdn.example/logo.png' });

      expect(upload.observed).toBe(false);
      expect(router.navigate).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });

    it('sends the admin back to the details step when the logo or project is missing', () => {
      setPrerequisitesStep();
      component['logoFile'].set(null);

      clickSubmit();

      expect(createProgram).not.toHaveBeenCalled();
      expect(component['step']()).toBe('details');
      expect(element().textContent).toContain(MENTORSHIP_ENROLL_FORM_INCOMPLETE);
    });

    it('shows a project error when the project id never resolved to a project', () => {
      setPrerequisitesStep();
      component['selectedProject'].set(null);

      clickSubmit();

      expect(createProgram).not.toHaveBeenCalled();
      expect(component['step']()).toBe('details');
      expect(component['stepErrors']().projectId).toBe(MENTORSHIP_ENROLL_PROJECT_REQUIRED);
    });

    it('checks the earlier steps again and sends the admin to the first one that no longer passes', () => {
      setPrerequisitesStep();
      const [term] = component['form'].getRawValue().terms;
      component['form'].controls.terms.setValue([{ ...term, applicationStartDate: '2020-01-01', applicationEndDate: '2020-01-02' }]);

      clickSubmit();

      expect(createProgram).not.toHaveBeenCalled();
      expect(component['step']()).toBe('setup');
      expect(component['stepErrors']().terms).toBeTruthy();
    });

    it('locks the answers while the create is pending and unlocks them if it fails', () => {
      const create = new Subject<MentorshipEnrollProgramRef>();
      createProgram.mockReturnValue(create);
      setPrerequisitesStep();
      const prerequisites = (): StubPrerequisitesStepComponent =>
        fixture.debugElement.query(By.directive(StubPrerequisitesStepComponent)).componentInstance as StubPrerequisitesStepComponent;

      clickSubmit();
      expect(component['form'].disabled).toBe(true);
      expect(prerequisites().locked()).toBe(true);

      create.error(httpError(500));
      fixture.detectChanges();
      expect(component['form'].enabled).toBe(true);
      expect(prerequisites().locked()).toBe(false);
    });
  });

  describe('create failures', () => {
    it('maps a 409 to the name field on the details step', () => {
      createProgram.mockReturnValue(throwError(() => httpError(409)));
      setPrerequisitesStep();

      clickSubmit();

      expect(component['step']()).toBe('details');
      expect(component['nameLookupStatus']()).toBe('taken');
      expect(component['stepErrors']().name).toBe(MENTORSHIP_ENROLL_NAME_TAKEN);
      expect(byTestId('mentorship-enroll-submit-error')).toBeNull();
      expect(uploadProgramLogo).not.toHaveBeenCalled();
    });

    it('blocks Next on the details step until the name changes after a 409', () => {
      createProgram.mockReturnValue(throwError(() => httpError(409)));
      setPrerequisitesStep();
      clickSubmit();
      component['nameLookupStatus'].set('available');

      component['onNext']();
      expect(component['step']()).toBe('details');
      expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ severity: 'warn', detail: MENTORSHIP_ENROLL_NAME_TAKEN }));

      component['form'].controls.name.setValue('GridFlow Mentorship Program 2');
      expect(component['nameTakenOnCreate']()).toBe(false);
    });

    it.each([400, 0, 500, 502])('shows the generic banner for a %i and never the upstream text', (status) => {
      createProgram.mockReturnValue(throwError(() => httpError(status, { message: 'upstream detail' })));
      setPrerequisitesStep();

      clickSubmit();

      const banner = byTestId('mentorship-enroll-submit-error');
      expect(banner?.textContent).toContain(MENTORSHIP_ENROLL_SUBMIT_FAILED);
      expect(banner?.textContent).not.toContain('upstream detail');
      expect(byTestId('mentorship-enroll-partial-save')).toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('shows the generic banner for a plain 403', () => {
      createProgram.mockReturnValue(throwError(() => httpError(403, { message: 'forbidden detail' })));
      setPrerequisitesStep();

      clickSubmit();

      expect(byTestId('mentorship-enroll-submit-error')?.textContent).toContain(MENTORSHIP_ENROLL_SUBMIT_FAILED);
    });

    it('keeps the form editable so the admin can resubmit after a create failure', () => {
      createProgram.mockReturnValueOnce(throwError(() => httpError(500)));
      setPrerequisitesStep();

      clickSubmit();
      expect(component['form'].enabled).toBe(true);

      clickSubmit();
      expect(createProgram).toHaveBeenCalledTimes(2);
      expect(router.navigate).toHaveBeenCalledWith(['/mentorship/admin']);
    });

    it('shows the server-authored message for an impersonation read-only 403', () => {
      createProgram.mockReturnValue(
        throwError(() => httpError(403, { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read-only while impersonating.' }))
      );
      setPrerequisitesStep();

      clickSubmit();

      expect(byTestId('mentorship-enroll-submit-error')?.textContent).toContain('Read-only while impersonating.');
    });
  });

  describe('logo failures (partial save)', () => {
    it('keeps the wizard on the last step with the partial-save banner after a logo failure', () => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(502)));
      setPrerequisitesStep();

      clickSubmit();

      expect(byTestId('mentorship-enroll-partial-save')?.textContent).toContain(MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED);
      expect(component['step']()).toBe('prerequisites');
      expect(router.navigate).not.toHaveBeenCalled();
      expect(component['form'].disabled).toBe(true);
    });

    it('disables Back once the program is saved', () => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(502)));
      setPrerequisitesStep();

      clickSubmit();

      expect(element().querySelector('[data-testid="mentorship-enroll-back"] button')?.hasAttribute('disabled')).toBe(true);
    });

    it.each([
      [413, MENTORSHIP_ENROLL_LOGO_TOO_LARGE],
      [415, MENTORSHIP_ENROLL_LOGO_TYPE_ERROR],
      [400, MENTORSHIP_ENROLL_LOGO_TYPE_ERROR],
      [503, MENTORSHIP_ENROLL_UPLOADS_UNAVAILABLE],
    ])('maps a logo %i to a field error beside the banner', (status, message) => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(status)));
      setPrerequisitesStep();

      clickSubmit();

      expect(byTestId('mentorship-enroll-partial-save')).not.toBeNull();
      expect(byTestId('mentorship-enroll-partial-save-logo-error')?.textContent).toContain(message);
    });

    it('shows only the banner for any other logo status', () => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(403)));
      setPrerequisitesStep();

      clickSubmit();

      expect(byTestId('mentorship-enroll-partial-save')).not.toBeNull();
      expect(byTestId('mentorship-enroll-partial-save-logo-error')).toBeNull();
    });

    it('retries without creating the program a second time', () => {
      uploadProgramLogo.mockReturnValueOnce(throwError(() => httpError(502)));
      setPrerequisitesStep();
      clickSubmit();

      byTestId('mentorship-enroll-partial-save-retry')?.querySelector('button')?.click();
      fixture.detectChanges();

      expect(createProgram).toHaveBeenCalledTimes(1);
      expect(uploadProgramLogo).toHaveBeenCalledTimes(2);
      expect(router.navigate).toHaveBeenCalledWith(['/mentorship/admin']);
    });

    it('uploads a replacement logo picked in the banner on the next retry', () => {
      uploadProgramLogo.mockReturnValueOnce(throwError(() => httpError(415)));
      setPrerequisitesStep();
      clickSubmit();

      const replacement = new File(['jpg'], 'replacement.jpg', { type: 'image/jpeg' });
      const input = byTestId('mentorship-enroll-partial-save-logo-input') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [replacement], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      byTestId('mentorship-enroll-partial-save-retry')?.querySelector('button')?.click();
      fixture.detectChanges();

      expect(uploadProgramLogo).toHaveBeenLastCalledWith(PROGRAM.id, replacement);
    });

    it('rejects a replacement logo of the wrong type without replacing the file', () => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(502)));
      setPrerequisitesStep();
      clickSubmit();

      const bad = new File(['gif'], 'logo.gif', { type: 'image/gif' });
      const input = byTestId('mentorship-enroll-partial-save-logo-input') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [bad], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(byTestId('mentorship-enroll-partial-save-logo-error')?.textContent).toContain(MENTORSHIP_ENROLL_LOGO_TYPE_ERROR);
      expect(component['logoFile']()).toBe(LOGO);
    });
  });

  describe('canLeave', () => {
    it('lets an untouched wizard leave without asking', async () => {
      expect(await component.canLeave()).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('asks before leaving with unsaved answers', async () => {
      component['form'].controls.name.setValue('Half typed');

      expect(await component.canLeave()).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('stays when the admin rejects the cancel prompt', async () => {
      confirm.mockImplementation((options: Confirmation) => {
        options.reject?.();
        return undefined;
      });
      component['form'].controls.name.setValue('Half typed');

      expect(await component.canLeave()).toBe(false);
    });

    it('asks with the "Logo missing" prompt after a partial save', async () => {
      uploadProgramLogo.mockReturnValue(throwError(() => httpError(502)));
      setPrerequisitesStep();
      clickSubmit();

      expect(await component.canLeave()).toBe(true);

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Logo missing', message: MENTORSHIP_ENROLL_LEAVE_LOGO_MISSING_CONFIRM, acceptLabel: 'Leave', rejectLabel: 'Stay' })
      );
    });

    it.each([
      ['the create', 'creating'],
      ['the logo upload', 'uploading-logo'],
    ])('holds the admin on the wizard without asking while %s is in flight', async (_label, phase) => {
      if (phase === 'creating') createProgram.mockReturnValue(NEVER);
      else uploadProgramLogo.mockReturnValue(NEVER);
      setPrerequisitesStep();
      clickSubmit();

      expect(component['submitPhase']()).toBe(phase);
      expect(await component.canLeave()).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('does not ask after a complete submit', async () => {
      setPrerequisitesStep();
      clickSubmit();
      confirm.mockClear();

      expect(await component.canLeave()).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('cancel and My Programs only navigate; the route guard does the asking', () => {
      component['form'].controls.name.setValue('Half typed');

      component['onCancel']();

      expect(router.navigate).toHaveBeenCalledWith(['/mentorship/admin']);
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
