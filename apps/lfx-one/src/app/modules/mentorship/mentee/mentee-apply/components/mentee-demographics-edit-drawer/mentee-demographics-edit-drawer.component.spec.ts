// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import {
  ERROR_CODES,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileUpdateRequest, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { MenteeDemographicsSectionComponent } from '../../../mentee-register/components/mentee-demographics-section/mentee-demographics-section.component';
import { MenteeDemographicsEditDrawerComponent } from './mentee-demographics-edit-drawer.component';

/* eslint-disable @angular-eslint/component-selector */
@Component({
  selector: 'p-drawer',
  template: '<ng-content /><ng-content select="[pTemplate=header]" />',
})
class StubDrawerComponent {
  readonly visible = input(false);
  readonly visibleChange = output<boolean>();
  readonly position = input('right');
  readonly modal = input(false);
  readonly closable = input(true);
  readonly dismissible = input(true);
  readonly closeOnEscape = input(true);
  readonly styleClass = input('');
  readonly pt = input<unknown>();
}

@Component({ selector: 'lfx-mentorship-mentee-demographics-section', template: '' })
class StubDemographicsSectionComponent {
  readonly form = input<FormGroup>();
  readonly isDrawer = input(false);
}

@Component({ selector: 'lfx-button', template: '' })
class StubButtonComponent {
  readonly label = input('');
  readonly type = input('');
  readonly variant = input('');
  readonly severity = input('');
  readonly size = input('');
  readonly disabled = input<boolean | undefined>(false);
  readonly loading = input(false);
  readonly onClick = output<MouseEvent>();
}
/* eslint-enable @angular-eslint/component-selector */

describe('MenteeDemographicsEditDrawerComponent', () => {
  let fixture: ComponentFixture<MenteeDemographicsEditDrawerComponent>;
  let comp: MenteeDemographicsEditDrawerComponent;
  let messageAdd: ReturnType<typeof vi.fn>;
  let updateMenteeProfile: ReturnType<typeof vi.fn<(request: MentorshipMenteeProfileUpdateRequest) => Observable<MentorshipMenteeProfileUpdateResponse>>>;
  let savedEvents: MentorshipMenteeProfileUpdateResponse[];

  const SAVED_RESPONSE: MentorshipMenteeProfileUpdateResponse = {
    profile: { aboutMe: '<p>Test User 1</p>', skillsHave: ['Go'], skillsWant: ['Rust'] },
    demographics: { age: '40-59' },
  };

  const errorElement = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-mentee-demographics-edit-drawer-error"]');
  const stub = <T>(selector: string): T => fixture.debugElement.query(By.css(selector)).componentInstance as T;
  const httpError = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

  beforeEach(async () => {
    messageAdd = vi.fn();
    updateMenteeProfile = vi.fn(() => of(SAVED_RESPONSE));
    savedEvents = [];

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MenteeDemographicsEditDrawerComponent],
      providers: [
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: MentorshipMenteeService, useValue: { updateMenteeProfile } },
      ],
    })
      .overrideComponent(MenteeDemographicsEditDrawerComponent, {
        remove: { imports: [DrawerModule, ButtonComponent, MenteeDemographicsSectionComponent] },
        add: { imports: [StubDrawerComponent, StubButtonComponent, StubDemographicsSectionComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MenteeDemographicsEditDrawerComponent);
    comp = fixture.componentInstance;
    comp.saved.subscribe((response) => savedEvents.push(response));
    fixture.detectChanges();
  });

  it('seeds consent and answer controls from saved demographics, opting out unanswered rows', () => {
    comp.seed({ age: '20-39', gender: 'preferNotToSay' });

    expect(comp['form'].controls.ageConsent.value).toBe(true);
    expect(comp['form'].controls.age.value).toBe('20-39');
    expect(comp['form'].controls.genderConsent.value).toBe(false);
    expect(comp['form'].controls.gender.value).toBe('');
    expect(comp['form'].controls.raceEthnicityConsent.value).toBe(false);
  });

  it('treats a missing demographics payload as no consent given', () => {
    comp.seed(undefined);

    expect(comp['form'].controls.ageConsent.value).toBe(false);
    expect(comp['form'].controls.educationConsent.value).toBe(false);
  });

  describe('save', () => {
    it('closes without a request, toast or saved event when nothing changed', () => {
      comp.seed({ age: '20-39', gender: 'preferNotToSay' });
      comp.visible.set(true);

      comp['onSave']();

      expect(updateMenteeProfile).not.toHaveBeenCalled();
      expect(messageAdd).not.toHaveBeenCalled();
      expect(savedEvents).toEqual([]);
      expect(comp.visible()).toBe(false);
    });

    it('sends only the changed group, keeping the stored answers of the unchanged rows', () => {
      comp.seed({ age: '20-39', gender: 'woman', income: '25000-49999' });
      comp.visible.set(true);
      comp['form'].controls.income.setValue('50000-99999');

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
      const request = updateMenteeProfile.mock.calls[0][0];
      expect(Object.keys(request)).toEqual(['socioeconomics']);
      expect(request.socioeconomics).toEqual({ income: '50000-99999' });
    });

    it('writes preferNotToSay for a row whose consent was withdrawn', () => {
      comp.seed({ age: '20-39', gender: 'woman' });
      comp['form'].controls.ageConsent.setValue(false);

      comp['onSave']();

      expect(updateMenteeProfile).toHaveBeenCalledWith({ demographics: { age: 'preferNotToSay', gender: 'woman' } });
    });

    it('never sends the introduction or skills', () => {
      comp.seed(undefined);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('20-39');

      comp['onSave']();

      const request = updateMenteeProfile.mock.calls[0][0];
      expect(request.introduction).toBeUndefined();
      expect(request.skillSet).toBeUndefined();
    });

    it('emits saved with the response, toasts the demographics summary and closes on success', () => {
      comp.seed(undefined);
      comp.visible.set(true);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');

      comp['onSave']();

      expect(savedEvents).toEqual([SAVED_RESPONSE]);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: MENTORSHIP_MENTEE_DEMOGRAPHICS_SAVE_SUCCESS_SUMMARY }));
      expect(comp.visible()).toBe(false);
    });

    it.each([
      [400, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[400]],
      [404, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[404]],
      [409, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[409]],
      [500, MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_FALLBACK],
    ])('keeps the drawer open with the answers and shows the message for a %i', (status, message) => {
      comp.seed(undefined);
      comp.visible.set(true);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(status)));

      comp['onSave']();
      fixture.detectChanges();

      expect(comp.visible()).toBe(true);
      expect(savedEvents).toEqual([]);
      expect(messageAdd).not.toHaveBeenCalled();
      expect(comp['form'].controls.age.value).toBe('40-59');
      expect(errorElement()?.getAttribute('role')).toBe('alert');
      expect(errorElement()?.textContent?.trim()).toBe(message);
      expect(comp['saving']()).toBe(false);
    });

    it('shows the server-authored message for the BFF validation 400', () => {
      comp.seed(undefined);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(400, { error: 'age is not a supported answer', code: ERROR_CODES.VALIDATION_ERROR })));

      comp['onSave']();
      fixture.detectChanges();

      expect(errorElement()?.textContent?.trim()).toBe('age is not a supported answer');
    });

    it('moves focus to the error alert once it renders, so it is reachable when Save sits below the fold', () => {
      comp.seed(undefined);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(500)));

      comp['onSave']();
      fixture.detectChanges();

      const alert = errorElement();
      expect(alert?.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(alert);
    });

    it('shows the server-authored message for the impersonation 403', () => {
      const message = 'This action is not available while impersonating a user';
      comp.seed(undefined);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(403, { error: message, code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE })));

      comp['onSave']();
      fixture.detectChanges();

      expect(errorElement()?.textContent?.trim()).toBe(message);
    });

    const failFirstSave = () => {
      comp.seed(undefined);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      updateMenteeProfile.mockReturnValueOnce(throwError(() => httpError(409)));
      comp['onSave']();
      expect(comp['errorMessage']()).not.toBe('');
    };

    it('clears the error when the next Save starts', () => {
      failFirstSave();
      updateMenteeProfile.mockReturnValueOnce(new Subject<MentorshipMenteeProfileUpdateResponse>());

      comp['onSave']();

      expect(comp['errorMessage']()).toBe('');
    });

    it('clears the error on any edit', () => {
      failFirstSave();

      comp['form'].controls.age.setValue('20-39');

      expect(comp['errorMessage']()).toBe('');
    });

    it('clears the error on re-seed', () => {
      failFirstSave();

      comp.seed(undefined);

      expect(comp['errorMessage']()).toBe('');
    });
  });

  describe('while saving', () => {
    beforeEach(() => {
      updateMenteeProfile.mockReturnValue(new Subject<MentorshipMenteeProfileUpdateResponse>());
      comp.seed(undefined);
      comp.visible.set(true);
      comp['form'].controls.ageConsent.setValue(true);
      comp['form'].controls.age.setValue('40-59');
      comp['onSave']();
      fixture.detectChanges();
    });

    it('disables Save and Cancel and makes the drawer non-dismissable', () => {
      expect(comp['saving']()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentorship-mentee-demographics-edit-drawer-save"]').loading()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentorship-mentee-demographics-edit-drawer-save"]').disabled()).toBe(true);
      expect(stub<StubButtonComponent>('[data-testid="mentorship-mentee-demographics-edit-drawer-cancel"]').disabled()).toBe(true);

      const drawerStub = stub<StubDrawerComponent>('p-drawer');
      expect(drawerStub.closable()).toBe(false);
      expect(drawerStub.dismissible()).toBe(false);
      expect(drawerStub.closeOnEscape()).toBe(false);
    });

    it('ignores Cancel and sends no second request for another Save', () => {
      comp['onCancel']();
      comp['onSave']();

      expect(comp.visible()).toBe(true);
      expect(updateMenteeProfile).toHaveBeenCalledTimes(1);
    });
  });

  it('closes without a toast on cancel', () => {
    comp.visible.set(true);

    comp['onCancel']();

    expect(comp.visible()).toBe(false);
    expect(messageAdd).not.toHaveBeenCalled();
  });
});
