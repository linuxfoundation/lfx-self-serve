// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTEE_REGISTER_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_REGISTER_ERROR_INELIGIBLE,
  MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTEE_REGISTER_ERROR_READ_ONLY,
  MENTORSHIP_MENTEE_RESUME_COMING_SOON_SUMMARY,
  MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY,
  MENTORSHIP_REGISTER_WARN_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeRegisterRequest } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeRegisterComponent } from './mentee-register.component';

/**
 * The real editor lazy-loads TipTap and mounts it against `document` in `afterNextRender`,
 * which the test environment tears down underneath it. The introduction field's behavior
 * under test is the validation gate, not the editor, so stand it down here — the exact
 * same swap `MentorRegisterComponent`'s spec uses.
 */
@Component({
  selector: 'lfx-rich-editor',
  template: '',
})
class StubRichEditorComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly placeholder = input<string>('');
  public readonly editorStyle = input<Record<string, string>>({});
  public readonly ariaLabelledBy = input<string>('');
  public readonly dataTest = input<string>();
}

describe('MenteeRegisterComponent', () => {
  let fixture: ComponentFixture<MenteeRegisterComponent>;
  let component: MenteeRegisterComponent;
  let toast: ReturnType<typeof vi.fn>;
  let registerMenteeProfile: ReturnType<typeof vi.fn<(request: MentorshipMenteeRegisterRequest) => Observable<void>>>;

  const applyIds = { programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const errorText = (testId: string): string | null => byTestId(testId)?.textContent?.trim() ?? null;
  const submitError = (): HTMLElement | null => byTestId('mentorship-mentee-submit-error');
  const httpFailure = (status: number, error: unknown): Observable<void> => throwError(() => new HttpErrorResponse({ status, error }));

  /** Fills every required field, so a spec can isolate the one it means to break. */
  const fillValidForm = (): void => {
    component['form'].patchValue({
      introduction: '<p>Backend engineer looking to break into distributed systems.</p>',
      skillsHave: ['Java'],
      skillsWant: ['Python'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();
  };

  const withApplyIds = (): void => {
    Object.defineProperty(TestBed.inject(ActivatedRoute), 'snapshot', {
      configurable: true,
      value: { queryParamMap: convertToParamMap(applyIds) },
    });
  };

  /** Submits the filled form and settles the navigation promise the success path chains onto. */
  const submit = async (): Promise<void> => {
    component['onSubmit']();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();
    registerMenteeProfile = vi.fn(() => of(undefined));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeRegisterComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: toast } },
        { provide: MentorshipMenteeService, useValue: { registerMenteeProfile } },
        // The profile card at the top of the page fetches these three itself, off the refresh
        // subject it shares with the profile shell.
        {
          provide: UserService,
          useValue: {
            identitiesRefresh$: new Subject<void>(),
            impersonating: signal(false),
            getCurrentUserProfile: () => of(null),
            getUserEmails: () => of(null),
            getIdentities: () => of([]),
            effectiveAvatarUrl: () => '',
          },
        },
      ],
    });

    await TestBed.overrideComponent(MenteeRegisterComponent, {
      remove: { imports: [RichEditorComponent] },
      add: { imports: [StubRichEditorComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MenteeRegisterComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  it('renders every top-level section of the registration form', () => {
    // The sections' `data-testid`s are what the design and the E2E specs anchor to;
    // a rename here is a UX break, not a refactor.
    for (const section of ['introduction', 'skills', 'resume', 'demographics', 'eligibility', 'compliance']) {
      expect(byTestId(`mentorship-mentee-${section}`)).not.toBeNull();
    }
    expect(element().querySelector('#mentorship-mentee-terms-text')).not.toBeNull();
  });

  it('no longer renders the dev dashboard shortcut', () => {
    expect(byTestId('mentorship-mentee-register-dev-shortcut')).toBeNull();
    expect(byTestId('mentorship-mentee-dev-dashboard')).toBeNull();
  });

  it('leads with the LFX profile card, so the mentee sees the identity the platform will use', () => {
    // Same ordering guarantee the mentor form makes — the profile card must precede the
    // form or the mentee could submit before noticing a stale name/email.
    const sections = [...element().querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));

    expect(sections.indexOf('mentorship-profile-card')).toBeLessThan(sections.indexOf('mentorship-mentee-introduction'));
  });

  it('keeps errors hidden until the mentee tries to submit', () => {
    // An empty form is invalid from the outset, but saying so before they act is noise.
    expect(component['errors']()).toEqual({});
    expect(errorText('mentorship-mentee-introduction-error')).toBeNull();

    component['onSubmit']();
    fixture.detectChanges();

    expect(errorText('mentorship-mentee-introduction-error')).toBe('Introduction is required.');
    expect(errorText('mentorship-mentee-compliance-error')).toBe('Please confirm the compliance statement.');
    expect(registerMenteeProfile).not.toHaveBeenCalled();
  });

  it('blocks submit when either skills field is empty — both feed the mentor match', () => {
    // Bugbot flagged the picker's required marker on `skillsWant`; the resolution was to
    // treat that field as mandatory (both fields shape the mentor match), so a blank on
    // either side must surface an error rather than let the toast claim success.
    fillValidForm();
    component['form'].controls.skillsWant.setValue([]);

    component['onSubmit']();
    fixture.detectChanges();

    expect(errorText('mentorship-mentee-want-skill-error')).toBe('Add at least one skill you would like to improve.');
    expect(registerMenteeProfile).not.toHaveBeenCalled();
  });

  it('warns rather than sends when a required eligibility box is missing', () => {
    fillValidForm();
    component['form'].controls.ageEligible.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'warn',
      summary: MENTORSHIP_REGISTER_WARN_SUMMARY,
      detail: 'Please confirm you are 18 years of age or older.',
    });
    expect(registerMenteeProfile).not.toHaveBeenCalled();
  });

  it('warns rather than sends when terms are declined', () => {
    fillValidForm();
    component['form'].controls.termsAccepted.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'warn', detail: 'Please accept the terms and conditions.' });
    expect(registerMenteeProfile).not.toHaveBeenCalled();
  });

  it('rejects a skill outside the catalog before sending', () => {
    fillValidForm();
    component['form'].controls.skillsHave.setValue(['Not A Skill']);

    component['onSubmit']();
    fixture.detectChanges();

    expect(registerMenteeProfile).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'warn' });
  });

  it('sends the built request once, with the consented demographics and no resume', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fillValidForm();
    component['form'].patchValue({
      additionalNotes: '  Test notes  ',
      resumeFileName: 'test-resume.pdf',
      ageConsent: true,
      age: '20-39',
      genderConsent: false,
      gender: 'female',
    });

    await submit();

    expect(registerMenteeProfile).toHaveBeenCalledTimes(1);
    const request = registerMenteeProfile.mock.calls[0][0];
    expect(request).toEqual({
      introduction: '<p>Backend engineer looking to break into distributed systems.</p>',
      skillsHave: ['Java'],
      skillsWant: ['Python'],
      additionalNotes: 'Test notes',
      demographics: { age: '20-39' },
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    expect(JSON.stringify(request)).not.toContain('test-resume.pdf');
  });

  it('keeps Submit loading and disabled while the save is in flight, and sends no second request', async () => {
    const pending = new Subject<void>();
    registerMenteeProfile.mockReturnValue(pending);
    fillValidForm();

    component['onSubmit']();
    fixture.detectChanges();
    component['onSubmit']();

    const submitButton = byTestId('mentorship-mentee-submit');
    expect(registerMenteeProfile).toHaveBeenCalledTimes(1);
    expect(component['submitting']()).toBe(true);
    expect(submitButton?.getAttribute('data-loading')).toBe('true');
    expect(submitButton?.querySelector('button')?.disabled).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('surfaces the success toast and lands on the mentee overview when there are no apply ids', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fillValidForm();

    await submit();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'success',
      summary: MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY,
      detail: MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL,
    });
    // Errors go back into hiding, so a second visit to the form starts clean.
    expect(component['errors']()).toEqual({});
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    expect(component['submitting']()).toBe(false);
  });

  it('returns to the same apply link after a save when both ids are present', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    withApplyIds();
    fillValidForm();

    await submit();

    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/apply'], {
      queryParams: applyIds,
      state: { menteeProfileCreated: true },
    });
  });

  it('re-enables Submit when the navigation after a save is cancelled', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    fillValidForm();

    await submit();

    expect(component['submitting']()).toBe(false);
  });

  it('treats the demographic answers as optional — leaving them blank still submits', async () => {
    // Every demographic field is gated behind its own consent checkbox; declining a
    // question is a valid answer, so a fully-blank demographics block must not block
    // submission when the required fields are complete.
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fillValidForm();

    await submit();

    expect(registerMenteeProfile).toHaveBeenCalledTimes(1);
    expect(registerMenteeProfile.mock.calls[0][0]).not.toHaveProperty('demographics');
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success' });
  });

  it('keeps resume upload coming-soon: Browse toasts and the file input is disabled', () => {
    byTestId('mentorship-mentee-resume-browse')?.querySelector('button')?.click();

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: MENTORSHIP_MENTEE_RESUME_COMING_SOON_SUMMARY }));
    expect((byTestId('mentorship-mentee-resume-file') as HTMLInputElement).disabled).toBe(true);
  });

  it('sends Cancel back to the mentorship admin page', () => {
    const cancel = element().querySelector('[data-testid="mentorship-mentee-cancel"] a');

    expect(cancel?.getAttribute('href')).toBe('/mentorship/admin');
  });

  describe('when the save fails', () => {
    it('shows a sticky profile-exists banner with a continue button, and leaves Submit usable', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      registerMenteeProfile.mockReturnValue(httpFailure(409, { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('profile-exists');
      expect(submitError()?.textContent).toContain(MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS);
      expect(toast).not.toHaveBeenCalled();
      expect(component['submitting']()).toBe(false);

      // Editing the form does not dismiss it: nothing the mentee types can fix an existing profile.
      component['form'].controls.additionalNotes.setValue('Edited');
      fixture.detectChanges();
      expect(submitError()).not.toBeNull();

      byTestId('mentorship-mentee-profile-exists-continue')?.querySelector('button')?.click();
      expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    });

    it('continues to the apply page without the created-state when apply ids are present', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      registerMenteeProfile.mockReturnValue(httpFailure(409, { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE }));
      withApplyIds();
      fillValidForm();

      await submit();
      component['onContinue']();

      expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/apply'], { queryParams: applyIds });
    });

    it('shows a sticky read-only banner while impersonating', async () => {
      registerMenteeProfile.mockReturnValue(httpFailure(403, { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('read-only');
      expect(submitError()?.textContent).toContain(MENTORSHIP_MENTEE_REGISTER_ERROR_READ_ONLY);
      expect(byTestId('mentorship-mentee-profile-exists-continue')).toBeNull();
      expect(toast).not.toHaveBeenCalled();
    });

    it('shows the server field error and a warn toast, keeps it through an identical re-emit, and clears it on a real edit', async () => {
      registerMenteeProfile.mockReturnValue(
        httpFailure(400, { code: 'VALIDATION_ERROR', errors: [{ field: 'skillsHave', message: 'Add at least one skill you currently have.' }] })
      );
      fillValidForm();

      await submit();

      expect(errorText('mentorship-mentee-have-skill-error')).toBe('Add at least one skill you currently have.');
      expect(submitError()).toBeNull();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast.mock.calls[0][0]).toMatchObject({
        severity: 'warn',
        summary: MENTORSHIP_REGISTER_WARN_SUMMARY,
        detail: 'Add at least one skill you currently have.',
      });

      // A re-emit with the same values (the rich editor does this on init) must not clear it.
      component['form'].updateValueAndValidity();
      fixture.detectChanges();
      expect(errorText('mentorship-mentee-have-skill-error')).toBe('Add at least one skill you currently have.');

      component['form'].controls.skillsHave.setValue(['Java', 'Rust']);
      fixture.detectChanges();
      expect(errorText('mentorship-mentee-have-skill-error')).toBeNull();
    });

    it('shows a keyed ineligible banner for a 422 and dismisses it on edit', async () => {
      registerMenteeProfile.mockReturnValue(httpFailure(422, { error: 'age eligibility is required' }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('ineligible');
      expect(submitError()?.textContent).toContain(MENTORSHIP_MENTEE_REGISTER_ERROR_INELIGIBLE);
      expect(submitError()?.textContent).not.toContain('age eligibility');

      component['form'].controls.additionalNotes.setValue('Edited');
      fixture.detectChanges();
      expect(submitError()).toBeNull();
    });

    it.each([500, 0])('shows the fallback banner for status %i and lets the mentee retry', async (status) => {
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      registerMenteeProfile.mockReturnValueOnce(httpFailure(status, null));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('error');
      expect(submitError()?.textContent).toContain(MENTORSHIP_MENTEE_REGISTER_ERROR_FALLBACK);
      expect(component['submitting']()).toBe(false);

      await submit();

      expect(registerMenteeProfile).toHaveBeenCalledTimes(2);
      expect(submitError()).toBeNull();
    });

    it('still shows the failure when the mentee edits the form while the save is in flight', async () => {
      const pending = new Subject<void>();
      registerMenteeProfile.mockReturnValueOnce(pending);
      fillValidForm();

      component['onSubmit']();
      component['form'].controls.additionalNotes.setValue('Edited while saving');
      fixture.detectChanges();
      pending.error(new HttpErrorResponse({ status: 500, error: null }));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(submitError()?.getAttribute('data-kind')).toBe('error');
      expect(component['submitting']()).toBe(false);
    });

    it('clears the previous failure when a new submit starts', async () => {
      const pending = new Subject<void>();
      registerMenteeProfile.mockReturnValueOnce(httpFailure(409, { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE }));
      registerMenteeProfile.mockReturnValueOnce(pending);
      fillValidForm();

      await submit();
      expect(submitError()).not.toBeNull();

      component['onSubmit']();
      fixture.detectChanges();

      expect(submitError()).toBeNull();
    });
  });
});
