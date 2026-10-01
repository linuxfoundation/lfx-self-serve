// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTOR_SUBMIT_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY,
  MENTORSHIP_REGISTER_ERROR_FALLBACK,
  MENTORSHIP_REGISTER_ERROR_READ_ONLY,
  MENTORSHIP_REGISTER_WARN_SUMMARY,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorOpenProgramsResponse,
  MentorshipMentorProgramRequest,
  MentorshipMentorRegisterRequest,
} from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MentorshipService } from '@services/mentorship.service';
import { UserService } from '@services/user.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MentorProgramRequestService } from '../../services/mentor-program-request.service';
import { MentorRegisterComponent } from './mentor-register.component';

/**
 * The real editor lazy-loads TipTap and mounts it against `document` in `afterNextRender`,
 * which the test environment tears down underneath it. The introduction field's behavior
 * under test is the validation gate, not the editor, so stand it down here.
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

describe('MentorRegisterComponent', () => {
  const program = (id: string, name: string): MentorshipMentorOpenProgram => ({ id, name });

  const programs: MentorshipMentorOpenProgramsResponse = { data: [program('mp_gridflow', 'GridFlow Ingestion')] };

  /** Stands in for requests the mentor already raised. The component itself starts empty. */
  const existingRequests: MentorshipMentorProgramRequest[] = [
    { id: 'req_gridflow', programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'accepted' },
  ];

  let fixture: ComponentFixture<MentorRegisterComponent>;
  let component: MentorRegisterComponent;
  let toast: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let registerMentorProfile: ReturnType<typeof vi.fn<(request: MentorshipMentorRegisterRequest) => Observable<void>>>;
  let getOpenPrograms: ReturnType<typeof vi.fn<() => Observable<MentorshipMentorOpenProgramsResponse>>>;
  let requestMany: ReturnType<typeof vi.fn<(programs: MentorshipMentorOpenProgram[]) => Observable<MentorshipMentorOpenProgram[]>>>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (testId: string): HTMLElement | null => element().querySelector(`[data-testid="${testId}"]`);
  const errorText = (testId: string): string | null => byTestId(testId)?.textContent?.trim() ?? null;
  const submitError = (): HTMLElement | null => byTestId('mentorship-mentor-submit-error');
  const httpFailure = (status: number, error: unknown): Observable<void> => throwError(() => new HttpErrorResponse({ status, error }));

  /** Fills every required field, so a spec can isolate the one it means to break. */
  const fillValidForm = (): void => {
    component['form'].patchValue({
      introduction: '<p>Maintainer on two CNCF projects.</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();
  };

  /** Submits the filled form and settles the navigation promise the success path chains onto. */
  const submit = async (): Promise<void> => {
    component['onSubmit']();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();
    registerMentorProfile = vi.fn<(request: MentorshipMentorRegisterRequest) => Observable<void>>(() => of(undefined));
    getOpenPrograms = vi.fn(() => of(programs));
    // The requests' own toasts and failure handling are covered by the service's spec.
    requestMany = vi.fn((picked: MentorshipMentorOpenProgram[]) => of(picked));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorRegisterComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: toast } },
        { provide: MentorshipMentorService, useValue: { registerMentorProfile, getOpenPrograms } },
        { provide: MentorProgramRequestService, useValue: { requestMany } },
        // The profile card syncs its fields through this; the page itself no longer reads programs from it.
        { provide: MentorshipService, useValue: { syncLfxProfileFields: () => of(undefined) } },
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

    await TestBed.overrideComponent(MentorRegisterComponent, {
      remove: { imports: [RichEditorComponent] },
      add: { imports: [StubRichEditorComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MentorRegisterComponent);
    component = fixture.componentInstance;

    // Stand down only `confirm`, on the page's own instance: the rendered `<p-confirmDialog>`
    // subscribes to the real service, so replacing the service wholesale breaks the dialog.
    // Accept by default, so a spec that means to test the cancel path says so explicitly.
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    confirm = vi.fn((options: Confirmation) => {
      options.accept?.();
      return confirmationService;
    });
    confirmationService.confirm = confirm;

    fixture.detectChanges();
  });

  it('renders every section of the registration form', () => {
    for (const section of ['programs', 'introduction', 'skills', 'resume', 'compliance']) {
      expect(element().querySelector(`[data-testid="mentorship-mentor-${section}"]`)).not.toBeNull();
    }
    expect(element().querySelector('#mentorship-mentor-terms-text')).not.toBeNull();
  });

  it('leads with the LFX profile card, so the mentor sees what the admin will receive', () => {
    const sections = [...element().querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid'));

    expect(sections.indexOf('mentorship-profile-card')).toBeLessThan(sections.indexOf('mentorship-mentor-programs'));
  });

  it('starts with no program requests, rather than showing requests the mentor never made', () => {
    expect(component['requests']()).toEqual([]);
    expect(element().querySelector('[data-testid^="mentorship-mentor-request-row-"]')).toBeNull();
  });

  it('no longer offers the dev-only My Programs shortcut', () => {
    expect(byTestId('mentorship-mentor-my-programs-button')).toBeNull();
  });

  it('keeps errors hidden until the mentor tries to submit', () => {
    // An empty form is invalid from the outset, but saying so before they act is noise.
    expect(component['errors']()).toEqual({});
    expect(errorText('mentorship-mentor-introduction-error')).toBeNull();

    component['onSubmit']();
    fixture.detectChanges();

    expect(errorText('mentorship-mentor-introduction-error')).toBe('Introduction is required.');
    expect(errorText('mentorship-mentor-compliance-error')).toBe('Please confirm the compliance statement.');
  });

  it('warns and sends nothing when a required field is missing', () => {
    fillValidForm();
    component['form'].controls.termsAccepted.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'warn', detail: 'Please accept the terms and conditions.' });
    expect(registerMentorProfile).not.toHaveBeenCalled();
  });

  it('sends the built request once, without the resume file name that has no upload yet', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fillValidForm();
    component['form'].controls.resumeFileName.setValue('resume.pdf');

    await submit();

    expect(registerMentorProfile).toHaveBeenCalledTimes(1);
    expect(registerMentorProfile).toHaveBeenCalledWith({
      introduction: '<p>Maintainer on two CNCF projects.</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    });
  });

  it('sends the name and picture the profile card shows with the registration', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    // The card's own derivation is covered by its spec; this pins that the page sends what the card holds at submit.
    const card = fixture.debugElement.query(By.directive(ProfileCardComponent)).componentInstance as ProfileCardComponent;
    Object.defineProperty(card, 'lfxProfileFields', {
      value: signal({ firstName: 'Test', lastName: 'User', logoUrl: 'https://example.com/avatar.png' }),
    });
    fillValidForm();

    await submit();

    expect(registerMentorProfile.mock.calls[0][0].lfxProfile).toEqual({
      firstName: 'Test',
      lastName: 'User',
      logoUrl: 'https://example.com/avatar.png',
    });
  });

  it('surfaces the success toast and lands on My Programs, even with no program requests', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fillValidForm();

    await submit();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'success',
      summary: MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY,
      detail: MENTORSHIP_MENTOR_SUBMIT_SUCCESS_DETAIL,
    });
    // Errors go back into hiding, so a second visit to the form starts clean.
    expect(component['errors']()).toEqual({});
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentor/programs']);
    expect(component['submitting']()).toBe(false);
  });

  it('offers the programs taking mentor requests in the picker', () => {
    expect(getOpenPrograms).toHaveBeenCalledTimes(1);
    expect(component['programs']()).toEqual(programs.data);
    expect(component['programsLoading']()).toBe(false);
  });

  it('leaves the picker empty, not loading, when the open programs cannot be read', async () => {
    getOpenPrograms.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })));
    fixture = TestBed.createComponent(MentorRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component['programs']()).toEqual([]);
    expect(component['programsLoading']()).toBe(false);
  });

  it('sends the picked programs once the profile is saved, then lands on My Programs', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component['onAddProgram'](program('mp_gridflow', 'GridFlow Ingestion'));
    component['onAddProgram'](program('mp_edgeops', 'EdgeOps Telemetry'));
    fillValidForm();

    await submit();

    expect(requestMany).toHaveBeenCalledTimes(1);
    expect(requestMany).toHaveBeenCalledWith([program('mp_gridflow', 'GridFlow Ingestion'), program('mp_edgeops', 'EdgeOps Telemetry')]);
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentor/programs']);
  });

  it('waits for the requests to settle before leaving, and keeps Submit loading meanwhile', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const pending = new Subject<MentorshipMentorOpenProgram[]>();
    requestMany.mockReturnValueOnce(pending);
    component['onAddProgram'](program('mp_gridflow', 'GridFlow Ingestion'));
    fillValidForm();

    await submit();

    expect(navigate).not.toHaveBeenCalled();
    expect(component['submitting']()).toBe(true);

    // Even when every request failed, the profile is saved, so the mentor still moves on.
    pending.next([]);
    pending.complete();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentor/programs']);
    expect(component['submitting']()).toBe(false);
  });

  it('sends no program requests when the profile save fails', async () => {
    registerMentorProfile.mockReturnValueOnce(httpFailure(500, null));
    component['onAddProgram'](program('mp_gridflow', 'GridFlow Ingestion'));
    fillValidForm();

    await submit();

    expect(requestMany).not.toHaveBeenCalled();
  });

  it('keeps Submit loading and disabled while the save is in flight, and sends no second request', () => {
    const pending = new Subject<void>();
    registerMentorProfile.mockReturnValue(pending);
    fillValidForm();

    component['onSubmit']();
    fixture.detectChanges();
    component['onSubmit']();

    const submitButton = byTestId('mentorship-mentor-submit');
    expect(registerMentorProfile).toHaveBeenCalledTimes(1);
    expect(component['submitting']()).toBe(true);
    expect(submitButton?.getAttribute('data-loading')).toBe('true');
    expect(submitButton?.querySelector('button')?.disabled).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('makes the profile card and the form fields inert while the save is in flight, and lifts it when the save fails', async () => {
    const pending = new Subject<void>();
    registerMentorProfile.mockReturnValueOnce(pending);
    fillValidForm();
    const fields = (): HTMLElement | null => byTestId('mentorship-mentor-register-fields');
    const card = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('lfx-mentorship-profile-card');
    expect(fields()?.hasAttribute('inert')).toBe(false);
    expect(card()?.hasAttribute('inert')).toBe(false);

    component['onSubmit']();
    fixture.detectChanges();

    expect(fields()?.hasAttribute('inert')).toBe(true);
    // An Edit LFX Profile save cannot change the name after the request was built.
    expect(card()?.hasAttribute('inert')).toBe(true);
    expect(fields()?.querySelector('[data-testid="mentorship-mentor-introduction"]')).not.toBeNull();
    // Submit stays outside the inert region, so its loading state is still reachable.
    expect(byTestId('mentorship-mentor-submit')?.closest('[inert]')).toBeNull();

    pending.error(new HttpErrorResponse({ status: 500, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fields()?.hasAttribute('inert')).toBe(false);
    expect(card()?.hasAttribute('inert')).toBe(false);
  });

  it('re-enables Submit and the form fields when the navigation after a save is cancelled', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
    fillValidForm();

    await submit();

    expect(component['submitting']()).toBe(false);
    expect(byTestId('mentorship-mentor-register-fields')?.hasAttribute('inert')).toBe(false);
  });

  it('raises a pending request for a picked program', () => {
    component['onAddProgram'](program('mp_gridflow', 'GridFlow Ingestion'));

    expect(component['requests']().at(-1)).toMatchObject({ programId: 'mp_gridflow', programName: 'GridFlow Ingestion', status: 'pending' });
  });

  it('ignores a program already requested, so it cannot be queued twice', () => {
    component['requests'].set([...existingRequests]);
    const [existing] = existingRequests;

    component['onAddProgram'](program(existing.programId, existing.programName));

    expect(component['requests']().length).toBe(existingRequests.length);
  });

  it('drops a withdrawn request once the mentor confirms', () => {
    component['requests'].set([...existingRequests]);
    const [existing] = existingRequests;

    component['onWithdraw'](existing.id);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(component['requests']().some((request) => request.id === existing.id)).toBe(false);
  });

  it('keeps the request when the mentor backs out of the confirmation', () => {
    confirm.mockImplementationOnce(() => undefined);
    component['requests'].set([...existingRequests]);

    component['onWithdraw'](existingRequests[0].id);

    expect(component['requests']()).toEqual(existingRequests);
  });

  it('sends Cancel back to the mentorship admin page', () => {
    const cancel = element().querySelector('[data-testid="mentorship-mentor-cancel"] a');

    expect(cancel?.getAttribute('href')).toBe('/mentorship/admin');
  });

  describe('when the save fails', () => {
    it('shows a sticky profile-exists banner with a continue button, and leaves Submit usable', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      registerMentorProfile.mockReturnValue(httpFailure(409, { code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('profile-exists');
      expect(submitError()?.textContent).toContain(MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS);
      expect(toast).not.toHaveBeenCalled();
      expect(component['submitting']()).toBe(false);

      // Editing the form does not dismiss it: nothing the mentor types can fix an existing profile.
      component['form'].controls.skills.setValue(['Kubernetes', 'Linux']);
      fixture.detectChanges();
      expect(submitError()).not.toBeNull();

      byTestId('mentorship-mentor-profile-exists-continue')?.querySelector('button')?.click();
      expect(navigate).toHaveBeenCalledWith(['/mentorship/mentor/programs']);
    });

    it('shows a sticky read-only banner while impersonating', async () => {
      registerMentorProfile.mockReturnValue(httpFailure(403, { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('read-only');
      expect(submitError()?.textContent).toContain(MENTORSHIP_REGISTER_ERROR_READ_ONLY);
      expect(byTestId('mentorship-mentor-profile-exists-continue')).toBeNull();
      expect(toast).not.toHaveBeenCalled();
    });

    it('shows the server field error and a warn toast, keeps it through an identical re-emit, and clears it on a real edit', async () => {
      registerMentorProfile.mockReturnValue(
        httpFailure(400, { code: 'VALIDATION_ERROR', errors: [{ field: 'introduction', message: 'Introduction is required.' }] })
      );
      fillValidForm();

      await submit();

      expect(errorText('mentorship-mentor-introduction-error')).toBe('Introduction is required.');
      expect(submitError()).toBeNull();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast.mock.calls[0][0]).toMatchObject({
        severity: 'warn',
        summary: MENTORSHIP_REGISTER_WARN_SUMMARY,
        detail: 'Introduction is required.',
      });

      // A re-emit with the same values (the rich editor does this on init) must not clear it.
      component['form'].updateValueAndValidity();
      fixture.detectChanges();
      expect(errorText('mentorship-mentor-introduction-error')).toBe('Introduction is required.');

      component['form'].controls.introduction.setValue('<p>Maintainer on three CNCF projects.</p>');
      fixture.detectChanges();
      expect(errorText('mentorship-mentor-introduction-error')).toBeNull();
    });

    it('shows the fallback banner for a 422, since the mentor form asks no eligibility questions', async () => {
      registerMentorProfile.mockReturnValue(httpFailure(422, { error: 'terms must be accepted' }));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('error');
      expect(submitError()?.textContent).toContain(MENTORSHIP_REGISTER_ERROR_FALLBACK);
      expect(submitError()?.textContent).not.toContain('terms must be accepted');

      component['form'].controls.skills.setValue(['Kubernetes', 'Linux']);
      fixture.detectChanges();
      expect(submitError()).toBeNull();
    });

    it.each([500, 0])('shows the fallback banner for status %i and lets the mentor retry', async (status) => {
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      registerMentorProfile.mockReturnValueOnce(httpFailure(status, null));
      fillValidForm();

      await submit();

      expect(submitError()?.getAttribute('data-kind')).toBe('error');
      expect(submitError()?.textContent).toContain(MENTORSHIP_REGISTER_ERROR_FALLBACK);
      expect(component['submitting']()).toBe(false);

      await submit();

      expect(registerMentorProfile).toHaveBeenCalledTimes(2);
      expect(submitError()).toBeNull();
    });

    it('still shows the failure when the mentor edits the form while the save is in flight', async () => {
      const pending = new Subject<void>();
      registerMentorProfile.mockReturnValueOnce(pending);
      fillValidForm();

      component['onSubmit']();
      component['form'].controls.skills.setValue(['Kubernetes', 'Linux']);
      fixture.detectChanges();
      pending.error(new HttpErrorResponse({ status: 500, error: null }));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(submitError()?.getAttribute('data-kind')).toBe('error');
      expect(component['submitting']()).toBe(false);
    });

    it('clears the previous failure when a new submit starts', async () => {
      const pending = new Subject<void>();
      registerMentorProfile.mockReturnValueOnce(httpFailure(409, { code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE }));
      registerMentorProfile.mockReturnValueOnce(pending);
      fillValidForm();

      await submit();
      expect(submitError()).not.toBeNull();

      component['onSubmit']();
      fixture.detectChanges();

      expect(submitError()).toBeNull();
    });
  });
});
