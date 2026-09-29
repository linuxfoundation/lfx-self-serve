// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_APPLY_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_CREATED_STATE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplyTarget, MentorshipMenteeProfileResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MenteeProfileEditDrawerComponent } from '../mentee-profile/components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.component';
import { MenteeBeforeYouApplyComponent } from './components/mentee-before-you-apply/mentee-before-you-apply.component';
import { MenteeApplyComponent } from './mentee-apply.component';

@Component({
  selector: 'lfx-mentorship-profile-card',
  template: '<div data-testid="mentorship-profile-card-stub"></div>',
})
class StubProfileCardComponent {}

@Component({
  selector: 'lfx-mentorship-mentee-profile-edit-drawer',
  template: '',
})
class StubMenteeProfileEditDrawerComponent {}

const target: MentorshipMenteeApplyTarget = {
  programName: 'Apicurio Registry: Prompt Template Playground',
  projectName: 'CNCF',
  termName: 'Winter 2026',
  acceptingApplications: true,
};

const menteeProfile: MentorshipMenteeProfileResponse = {
  profile: { aboutMe: 'Test mentee introduction.', skillsHave: ['Go'], skillsWant: ['Code Review'] },
  history: [],
};

const applyParams = { programId: '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e', programTermId: '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e' };

describe('MenteeApplyComponent', () => {
  let fixture: ComponentFixture<MenteeApplyComponent>;
  let getMenteeApplyTarget: ReturnType<typeof vi.fn>;
  let getMenteeProfile: ReturnType<typeof vi.fn>;
  let applyToMenteeTerm: ReturnType<typeof vi.fn>;
  let clearMenteeCaches: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;
  let navigate: MockInstance<Router['navigate']>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const submitButton = (): HTMLButtonElement | null => element().querySelector('[data-testid="mentorship-mentee-apply-submit"] button');
  const blockedState = (): HTMLElement | null => element().querySelector('[data-testid="mentorship-mentee-apply-blocked"]');

  const routeFor = (params: Record<string, string>) => ({
    snapshot: { queryParamMap: convertToParamMap(params) },
    queryParamMap: of(convertToParamMap(params)),
  });

  const bootstrap = async (params: Record<string, string>): Promise<void> => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: routeFor(params) });
    await TestBed.overrideComponent(MenteeApplyComponent, {
      remove: { imports: [ProfileCardComponent, MenteeProfileEditDrawerComponent] },
      add: { imports: [StubProfileCardComponent, StubMenteeProfileEditDrawerComponent] },
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(MenteeApplyComponent);
    fixture.detectChanges();
  };

  const checkEveryConfirmation = (): void => {
    const before = fixture.debugElement.query(By.directive(MenteeBeforeYouApplyComponent)).componentInstance as MenteeBeforeYouApplyComponent;
    before['form'].setValue({
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();
  };

  const submit = (): void => {
    checkEveryConfirmation();
    submitButton()?.click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getMenteeApplyTarget = vi.fn(() => of(target));
    getMenteeProfile = vi.fn(() => of(menteeProfile));
    applyToMenteeTerm = vi.fn(() => of(undefined));
    clearMenteeCaches = vi.fn();
    toast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplyComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: routeFor(applyParams) },
        { provide: MentorshipMenteeService, useValue: { getMenteeApplyTarget, getMenteeProfile, applyToMenteeTerm, clearMenteeCaches } },
        { provide: MessageService, useValue: { add: toast } },
      ],
    });
  });

  it('shows an incomplete-link state and does not call the API when either id is missing', async () => {
    await bootstrap({ programId: applyParams.programId });

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-missing"]')?.textContent).toContain('This application link is incomplete');
    expect(getMenteeApplyTarget).not.toHaveBeenCalled();
    expect(getMenteeProfile).not.toHaveBeenCalled();
  });

  it('renders the header, back link, and the four review sections', async () => {
    await bootstrap(applyParams);

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-title"]')?.textContent).toContain(
      'Apply to Apicurio Registry: Prompt Template Playground'
    );
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-subtitle"]')?.textContent).toContain('CNCF · Winter 2026');
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-back"] a')?.getAttribute('href')).toBe('/mentorship/mentee/overview');
    expect(element().querySelector('[data-testid="mentorship-profile-card-stub"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-title"]')?.textContent).toContain('Your Mentee Profile');
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-demographics"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-before"]')).not.toBeNull();
    expect(getMenteeApplyTarget).toHaveBeenCalledWith(applyParams.programId, applyParams.programTermId);
  });

  it('shows only the term name when the program has no project', async () => {
    getMenteeApplyTarget.mockReturnValue(of({ ...target, projectName: '' }));
    await bootstrap(applyParams);

    const subtitle = element().querySelector('[data-testid="mentorship-mentee-apply-subtitle"]')?.textContent ?? '';
    expect(subtitle.trim()).toBe('Winter 2026');
  });

  it('keeps submit disabled until every confirmation is checked, then files the application and goes to the Overview', async () => {
    await bootstrap(applyParams);

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-remaining"]')?.textContent).toContain('5 remaining');
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-cancel"] a')?.getAttribute('href')).toBe('/mentorship/mentee/overview');
    expect(submitButton()?.disabled).toBe(true);

    checkEveryConfirmation();

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-remaining"]')?.textContent).toContain('0 remaining');
    expect(submitButton()?.disabled).toBe(false);

    submitButton()?.click();

    expect(applyToMenteeTerm).toHaveBeenCalledWith(applyParams);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY }));
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
  });

  it('shows a not-found state when the term does not exist', async () => {
    getMenteeApplyTarget.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await bootstrap(applyParams);

    expect(blockedState()?.getAttribute('data-reason')).toBe('not-found');
    expect(blockedState()?.textContent).toContain('This program term could not be found');
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-error"]')).toBeNull();
  });

  it('shows a retry when the apply target cannot be loaded', async () => {
    getMenteeApplyTarget.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await bootstrap(applyParams);

    const error = element().querySelector('[data-testid="mentorship-mentee-apply-error"]');
    expect(error?.textContent).toContain('Could not load this application');

    (error?.querySelector('button') as HTMLButtonElement | null)?.click();
    fixture.detectChanges();

    expect(getMenteeApplyTarget).toHaveBeenCalledTimes(2);
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-title"]')).not.toBeNull();
  });

  it('shows the closed state instead of the form when the term is not taking applications', async () => {
    getMenteeApplyTarget.mockReturnValue(of({ ...target, acceptingApplications: false }));
    await bootstrap(applyParams);

    expect(blockedState()?.getAttribute('data-reason')).toBe('closed');
    expect(blockedState()?.textContent).toContain('This term is not accepting applications');
    expect(submitButton()).toBeNull();
  });

  it('swaps the form for the closed state when upstream refuses the application with 422', async () => {
    applyToMenteeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
    await bootstrap(applyParams);

    submit();

    expect(blockedState()?.getAttribute('data-reason')).toBe('closed');
    expect(clearMenteeCaches).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the already-applied state on 409 and drops the cached applications', async () => {
    applyToMenteeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    await bootstrap(applyParams);

    submit();

    expect(blockedState()?.getAttribute('data-reason')).toBe('already-applied');
    expect(blockedState()?.textContent).toContain('You already applied to this term');
    expect(clearMenteeCaches).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('toasts and keeps the form when the impersonation guard refuses the application', async () => {
    applyToMenteeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE } })));
    await bootstrap(applyParams);

    submit();

    expect(blockedState()).toBeNull();
    expect(submitButton()?.disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY }));
  });

  it('toasts the fallback and re-enables submit when the application fails', async () => {
    applyToMenteeTerm.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await bootstrap(applyParams);

    submit();

    expect(blockedState()).toBeNull();
    expect(submitButton()?.disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY, detail: MENTORSHIP_MENTEE_APPLY_ERROR_FALLBACK })
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets a mentee who just registered submit without checking confirmations, and clears the one-time flag', async () => {
    const getState = vi.fn().mockReturnValue({ [MENTORSHIP_MENTEE_PROFILE_CREATED_STATE]: true });
    const replaceState = vi.fn();
    TestBed.overrideProvider(Location, { useValue: { getState, replaceState, path: () => '/mentorship/mentee/apply' } });

    await bootstrap(applyParams);

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-before"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-remaining"]')).toBeNull();
    expect(submitButton()?.disabled).toBe(false);
    expect(replaceState).toHaveBeenCalled();

    submitButton()?.click();

    expect(applyToMenteeTerm).toHaveBeenCalledWith(applyParams);
    expect(navigate).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
  });
});
