// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_COMING_SOON_TOAST_LIFE, MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
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
  readonly onClick = output<MouseEvent>();
}
/* eslint-enable @angular-eslint/component-selector */

describe('MenteeDemographicsEditDrawerComponent', () => {
  let fixture: ComponentFixture<MenteeDemographicsEditDrawerComponent>;
  let comp: MenteeDemographicsEditDrawerComponent;
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    messageAdd = vi.fn();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MenteeDemographicsEditDrawerComponent],
      providers: [{ provide: MessageService, useValue: { add: messageAdd } }],
    })
      .overrideComponent(MenteeDemographicsEditDrawerComponent, {
        remove: { imports: [DrawerModule, ButtonComponent, MenteeDemographicsSectionComponent] },
        add: { imports: [StubDrawerComponent, StubButtonComponent, StubDemographicsSectionComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MenteeDemographicsEditDrawerComponent);
    comp = fixture.componentInstance;
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

  it('fires the coming-soon toast and closes on save', () => {
    comp.visible.set(true);

    comp['onSave']();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        summary: MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL,
        detail: MENTORSHIP_COMING_SOON_DETAIL,
        life: MENTORSHIP_COMING_SOON_TOAST_LIFE,
      })
    );
    expect(comp.visible()).toBe(false);
  });

  it('closes without a toast on cancel', () => {
    comp.visible.set(true);

    comp['onCancel']();

    expect(comp.visible()).toBe(false);
    expect(messageAdd).not.toHaveBeenCalled();
  });
});
