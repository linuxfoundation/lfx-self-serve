// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_MENTEE_PROFILE_CREATED_STATE, MOCK_MENTORSHIP_MENTEE_PROFILE } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplyTarget } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
};

const applyParams = { programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' };

describe('MenteeApplyComponent', () => {
  let fixture: ComponentFixture<MenteeApplyComponent>;
  let getMenteeApplyTarget: ReturnType<typeof vi.fn>;
  let getMenteeProfile: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const submitButton = (): HTMLButtonElement | null => element().querySelector('[data-testid="mentorship-mentee-apply-submit"] button');

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
    fixture = TestBed.createComponent(MenteeApplyComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    getMenteeApplyTarget = vi.fn(() => of(target));
    getMenteeProfile = vi.fn(() => of(MOCK_MENTORSHIP_MENTEE_PROFILE));
    toast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeApplyComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: routeFor(applyParams) },
        { provide: MentorshipService, useValue: { getMenteeApplyTarget, getMenteeProfile } },
        { provide: MessageService, useValue: { add: toast } },
      ],
    });
  });

  it('shows an incomplete-link state and does not call the API when either id is missing', async () => {
    await bootstrap({ programId: 'mp_apicurio_winter26' });

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
    expect(getMenteeApplyTarget).toHaveBeenCalledWith('mp_apicurio_winter26', 'trm_apicurio_winter26');
  });

  it('keeps submit disabled until every confirmation is checked, then reports that the application was not sent', async () => {
    await bootstrap(applyParams);

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-remaining"]')?.textContent).toContain('5 remaining');
    expect(element().querySelector('[data-testid="mentorship-mentee-apply-cancel"] a')?.getAttribute('href')).toBe('/mentorship/mentee/overview');
    expect(submitButton()?.disabled).toBe(true);

    const before = fixture.debugElement.query(By.directive(MenteeBeforeYouApplyComponent)).componentInstance as MenteeBeforeYouApplyComponent;
    before['form'].setValue({
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-remaining"]')?.textContent).toContain('0 remaining');
    expect(submitButton()?.disabled).toBe(false);

    submitButton()?.click();

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Submit Application', detail: MENTORSHIP_COMING_SOON_DETAIL }));
  });

  it('shows a retry when the apply target cannot be loaded', async () => {
    getMenteeApplyTarget.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await bootstrap(applyParams);

    expect(element().querySelector('[data-testid="mentorship-mentee-apply-error"]')?.textContent).toContain('Could not load this application');
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

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Submit Application', detail: MENTORSHIP_COMING_SOON_DETAIL }));
  });
});
