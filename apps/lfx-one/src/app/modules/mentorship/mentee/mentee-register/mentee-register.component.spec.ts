// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { MENTORSHIP_COMING_SOON_DETAIL } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
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

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const errorText = (testId: string): string | null => element().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? null;

  /** Fills every required field, so a spec can isolate the one it means to break. */
  const fillValidForm = (): void => {
    component['form'].patchValue({
      introduction: '<p>Backend engineer looking to break into distributed systems.</p>',
      skillsHave: ['Go'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeRegisterComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: toast } },
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
      expect(element().querySelector(`[data-testid="mentorship-mentee-${section}"]`)).not.toBeNull();
    }
    expect(element().querySelector('#mentorship-mentee-terms-text')).not.toBeNull();
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
  });

  it('warns rather than succeeds when a required eligibility box is missing', () => {
    fillValidForm();
    component['form'].controls.ageEligible.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'warn',
      detail: 'Please confirm you are 18 years of age or older.',
    });
  });

  it('warns rather than succeeds when terms are declined', () => {
    fillValidForm();
    component['form'].controls.termsAccepted.setValue(false);

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'warn', detail: 'Please accept the terms and conditions.' });
  });

  it('says submitting is not available yet rather than claiming the registration was sent', () => {
    fillValidForm();

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    // Nothing is persisted, so a success toast here would be a false confirmation.
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'info',
      summary: 'Submit mentee registration',
      detail: MENTORSHIP_COMING_SOON_DETAIL,
    });
    // Errors go back into hiding, so a second visit to the form starts clean.
    expect(component['errors']()).toEqual({});
  });

  it('treats the demographic answers as optional — leaving them blank still submits', () => {
    // Every demographic field is gated behind its own consent checkbox; declining a
    // question is a valid answer, so a fully-blank demographics block must not block
    // submission when the required fields are complete.
    fillValidForm();

    component['onSubmit']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info' });
  });

  it('sends Cancel back to the mentorship admin page', () => {
    const cancel = element().querySelector('[data-testid="mentorship-mentee-cancel"] a');

    expect(cancel?.getAttribute('href')).toBe('/mentorship/admin');
  });
});
