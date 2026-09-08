// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaAttestationComponent } from './org-easycla-attestation.component';

/**
 * The attestation gate, from the browser's side.
 *
 * The controller specs prove the server refuses an unaffirmed request. These prove the two things
 * only the client can be wrong about: that the control cannot be reached without both boxes, and
 * that what leaves the dialog is what the signatory actually set rather than a literal written
 * on the way out.
 */
describe('OrgEasyclaAttestationComponent', () => {
  const close = vi.fn();

  async function render(): Promise<ComponentFixture<OrgEasyclaAttestationComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaAttestationComponent],
      providers: [{ provide: DynamicDialogRef, useValue: { close } }],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaAttestationComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Reaches the component's own form, which is what the template binds and the click reads. */
  function form(fixture: ComponentFixture<OrgEasyclaAttestationComponent>) {
    return (fixture.componentInstance as unknown as { form: { controls: Record<string, { setValue: (v: boolean) => void }> } }).form;
  }

  function continueButton(fixture: ComponentFixture<OrgEasyclaAttestationComponent>): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="org-easycla-attestation-continue"] button') as HTMLButtonElement;
  }

  beforeEach(() => close.mockClear());

  it('opens with neither confirmation given', async () => {
    const fixture = await render();

    const boxes = Array.from(fixture.nativeElement.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => !box.checked)).toBe(true);
  });

  it('cannot be continued with neither confirmation', async () => {
    const fixture = await render();

    expect(continueButton(fixture).disabled).toBe(true);
  });

  it.each([['authorityAcked'], ['embargoAcked']])('cannot be continued with only %s given', async (control) => {
    const fixture = await render();

    form(fixture).controls[control].setValue(true);
    fixture.detectChanges();

    expect(continueButton(fixture).disabled).toBe(true);
  });

  it('can be continued once both are given', async () => {
    const fixture = await render();

    form(fixture).controls['authorityAcked'].setValue(true);
    form(fixture).controls['embargoAcked'].setValue(true);
    fixture.detectChanges();

    expect(continueButton(fixture).disabled).toBe(false);
  });

  // Withdrawal must re-close the gate. A `bothAcked` computed once and cached, or a flag set on
  // first tick and never cleared, would leave the control live after the signatory changed their
  // mind — and the request would then carry an affirmation they had visibly retracted.
  it('cannot be continued again after a confirmation is withdrawn', async () => {
    const fixture = await render();

    form(fixture).controls['authorityAcked'].setValue(true);
    form(fixture).controls['embargoAcked'].setValue(true);
    fixture.detectChanges();
    form(fixture).controls['embargoAcked'].setValue(false);
    fixture.detectChanges();

    expect(continueButton(fixture).disabled).toBe(true);
  });

  it('closes with both confirmations as the signatory set them', async () => {
    const fixture = await render();

    form(fixture).controls['authorityAcked'].setValue(true);
    form(fixture).controls['embargoAcked'].setValue(true);
    fixture.detectChanges();
    continueButton(fixture).click();

    expect(close).toHaveBeenCalledWith({ authorityAcked: true, embargoAcked: true });
  });

  // The load-bearing one. Invoking continue directly bypasses the disabled attribute, which is
  // exactly what a regression in the template would do. Nothing must close the dialog with an
  // affirmation the form does not hold.
  it('closes with nothing when continue is invoked while a confirmation is withdrawn', async () => {
    const fixture = await render();

    form(fixture).controls['authorityAcked'].setValue(true);
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { onContinue: () => void }).onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with nothing when the signatory backs out', async () => {
    const fixture = await render();

    (fixture.nativeElement.querySelector('[data-testid="org-easycla-attestation-cancel"] button') as HTMLButtonElement).click();

    expect(close).toHaveBeenCalledWith(null);
  });

  it('renders the approved wording verbatim', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain(CCLA_SIGN_COPY.attestation.authorityHeading);
    expect(text).toContain(CCLA_SIGN_COPY.attestation.authorityLabel);
    expect(text).toContain(CCLA_SIGN_COPY.attestation.embargoHeading);
    expect(text).toContain(CCLA_SIGN_COPY.attestation.embargoLabel);
    for (const condition of CCLA_SIGN_COPY.attestation.embargoConditions) {
      expect(text).toContain(condition);
    }
    expect(text).toContain(CCLA_SIGN_COPY.attestation.embargoSanctionsCondition.linkText);
  });

  it('links the sanctions authority without handing it control of this page', async () => {
    const fixture = await render();

    const link = fixture.nativeElement.querySelector('[data-testid="org-easycla-attestation-conditions"] a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(CCLA_SIGN_COPY.attestation.embargoSanctionsCondition.linkUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  // Self-sign only in this feature. A disabled "I am not authorized" control would tell a
  // signatory who genuinely is not authorized that they have no route at all.
  it('offers no designee control, neither operable nor disabled', async () => {
    const fixture = await render();
    const text = ((fixture.nativeElement as HTMLElement).textContent ?? '').toLowerCase();

    expect(text).not.toContain('i am not authorized');
  });
});
