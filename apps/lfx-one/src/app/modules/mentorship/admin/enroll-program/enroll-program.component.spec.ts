// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { createEmptyMentorshipEnrollForm, MENTORSHIP_COMING_SOON_DETAIL } from '@lfx-one/shared/constants';
import { MentorshipCiiLookupStatus, MentorshipEnrollFieldErrors, MentorshipEnrollStep, MentorshipNameLookupStatus } from '@lfx-one/shared/interfaces';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
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
}

describe('EnrollProgramComponent', () => {
  let fixture: ComponentFixture<EnrollProgramComponent>;
  let component: EnrollProgramComponent;
  let toast: ReturnType<typeof vi.fn>;
  let router: Router;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

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
    fixture.detectChanges();
  };

  /** Sets the wizard directly to the prerequisites step with a valid form. */
  const setPrerequisitesStep = (): void => {
    fillValidForm();
    component['nameLookupStatus'].set('available');
    component['step'].set('prerequisites');
    fixture.detectChanges();
  };

  beforeEach(async () => {
    toast = vi.fn();

    TestBed.configureTestingModule({
      imports: [EnrollProgramComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: { add: toast } },
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
    confirmationService.confirm = vi.fn((options: Confirmation) => {
      options.accept?.();
      return confirmationService;
    });

    fixture.detectChanges();
  });

  it('renders the enrollment wizard shell', () => {
    expect(element().querySelector('[data-testid="mentorship-enroll"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-enroll-title"]')?.textContent).toContain('Enroll a Program');
  });

  it('shows a coming-soon toast on submit without claiming enrollment was created', () => {
    setPrerequisitesStep();

    component['onNext']();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      severity: 'info',
      summary: 'Submit enrollment',
      detail: MENTORSHIP_COMING_SOON_DETAIL,
    });
  });

  it('does not navigate away after submission, so the user keeps their work', () => {
    setPrerequisitesStep();

    component['onNext']();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not issue any HTTP request on submission', () => {
    setPrerequisitesStep();
    const httpTesting = TestBed.inject(HttpTestingController);

    component['onNext']();

    httpTesting.verify();
  });

  it('preserves form values and logo preview after the coming-soon toast', () => {
    setPrerequisitesStep();
    component['form'].controls.logoPreviewUrl.setValue('blob:http://localhost/fake-preview');

    component['onNext']();

    expect(component['form'].controls.name.value).toBe('GridFlow Mentorship Program');
    expect(component['form'].controls.logoPreviewUrl.value).toBe('blob:http://localhost/fake-preview');
  });
});
