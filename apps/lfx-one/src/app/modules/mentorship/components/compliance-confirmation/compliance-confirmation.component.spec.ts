// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_COMPLIANCE_ITEMS, MENTORSHIP_MENTOR_COMPLIANCE_LEAD } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { ComplianceConfirmationComponent } from './compliance-confirmation.component';

describe('ComplianceConfirmationComponent', () => {
  let fixture: ComponentFixture<ComplianceConfirmationComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ComplianceConfirmationComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(ComplianceConfirmationComponent);
    fixture.componentRef.setInput('form', new FormGroup({ complianceAccepted: new FormControl(false, { nonNullable: true }) }));
    fixture.componentRef.setInput('idPrefix', 'mentorship-mentee');
    fixture.detectChanges();
  });

  it('renders the certification lead and every item, and points the checkbox at them', () => {
    const text = element().querySelector('#mentorship-mentee-compliance-text');

    expect(text?.textContent).toContain(MENTORSHIP_MENTOR_COMPLIANCE_LEAD);
    expect(Array.from(text?.querySelectorAll('li') ?? []).map((item) => item.textContent?.trim())).toEqual([...MENTORSHIP_MENTOR_COMPLIANCE_ITEMS]);
    expect(element().querySelector('[aria-labelledby="mentorship-mentee-compliance-text"]')).not.toBeNull();
  });

  it('marks the text as required unless the caller turns the asterisk off', () => {
    expect(element().querySelector('#mentorship-mentee-compliance-text .text-red-500')?.textContent?.trim()).toBe('*');

    fixture.componentRef.setInput('markRequired', false);
    fixture.detectChanges();

    expect(element().querySelector('#mentorship-mentee-compliance-text .text-red-500')).toBeNull();
  });

  it('shows the error the caller passes down', () => {
    expect(element().querySelector('[data-testid="mentorship-mentee-compliance-error"]')).toBeNull();

    fixture.componentRef.setInput('error', 'Please confirm the compliance statement.');
    fixture.detectChanges();

    const error = element().querySelector('[data-testid="mentorship-mentee-compliance-error"]');
    expect(error?.textContent?.trim()).toBe('Please confirm the compliance statement.');
    expect(error?.getAttribute('role')).toBe('alert');
  });
});
