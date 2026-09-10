// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_POLICY_LINKS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { TermsAcknowledgementComponent } from './terms-acknowledgement.component';

describe('TermsAcknowledgementComponent', () => {
  let fixture: ComponentFixture<TermsAcknowledgementComponent>;
  let form: FormGroup<{ termsAccepted: FormControl<boolean> }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    form = new FormGroup({ termsAccepted: new FormControl(false, { nonNullable: true }) });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TermsAcknowledgementComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(TermsAcknowledgementComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('intro', 'Review and accept the terms below.');
    fixture.componentRef.setInput('idPrefix', 'mentorship-mentor');
    fixture.detectChanges();
  });

  it('links every policy the acknowledgement names, opening each safely', () => {
    const anchors = Array.from(element().querySelectorAll('a'));

    expect(anchors.map((anchor) => anchor.getAttribute('href'))).toEqual(MENTORSHIP_POLICY_LINKS.map((link) => link.href));
    // A blank target without noopener hands the opened page a window reference back.
    expect(anchors.every((anchor) => anchor.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
    expect(anchors.every((anchor) => anchor.getAttribute('target') === '_blank')).toBe(true);
  });

  it('points the checkbox at the acknowledgement text, since the label is a paragraph', () => {
    const labelled = element().querySelector('[aria-labelledby="mentorship-mentor-terms-text"]');

    expect(labelled).not.toBeNull();
    expect(element().querySelector('#mentorship-mentor-terms-text')).not.toBeNull();
  });

  it('shows the error the caller passes down', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-terms-error"]')).toBeNull();

    fixture.componentRef.setInput('error', 'Please accept the terms and conditions.');
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-terms-error"]')?.textContent?.trim()).toBe('Please accept the terms and conditions.');
  });
});
