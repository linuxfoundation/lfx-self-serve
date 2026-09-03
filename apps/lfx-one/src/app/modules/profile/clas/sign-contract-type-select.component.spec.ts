// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { SIGN_CONTRACT_TYPE_COPY } from '@lfx-one/shared/constants';
import type { ClaKind } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignContractTypeSelectComponent } from './sign-contract-type-select.component';

/**
 * Covers the Gerrit contract-type step opened by DialogService (#2066).
 *
 * What these tests protect is the binding between the card the contributor reads and the route
 * segment the hand-off uses. The two are joined only by a template `[value]`, and getting them
 * the wrong way round would send a contributor who chose "Individual Contributor" to sign a
 * corporate agreement — so the choice is always made by clicking, never by writing to the form.
 * The single exception is the held-type submit guard, which exists for the case where something
 * other than a click supplied the value, and so cannot be reached by clicking.
 */
describe('SignContractTypeSelectComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<SignContractTypeSelectComponent>;

  async function setup(heldKinds: readonly ClaKind[] = []): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [SignContractTypeSelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { heldKinds } } },
      ],
    });

    fixture = TestBed.createComponent(SignContractTypeSelectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Picks a card the way a click does — the card writes the chosen value into the form. */
  async function choose(testId: string): Promise<void> {
    query(testId)?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function continueToSign(): void {
    (fixture.componentInstance as any).onContinue();
  }

  /**
   * Writes the form the way nothing in the UI does — the deliberate exception to the rule above,
   * used only to reach the submit path with the cards bypassed.
   */
  function preselect(contractType: 'individual' | 'corporate'): void {
    (fixture.componentInstance as any).selectForm.controls.contractType.setValue(contractType);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await setup();
  });

  it('offers both contributor types, with the Console decision screen’s wording', async () => {
    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.body);
    expect(query('sign-contract-type-select-individual')?.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.individual.label);
    expect(query('sign-contract-type-select-corporate')?.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.corporate.label);
    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.individual.description);
    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.corporate.description);
  });

  it('announces each type’s description with the card it belongs to', async () => {
    // Which type applies depends on who owns the work, and only the descriptions say so. Focus
    // lands on the card, so a description that is merely adjacent is announced to nobody. Resolved
    // through the DOM rather than compared as a string, because a stale or swapped id is exactly
    // the failure this guards — and it would still read as a present `aria-describedby`.
    for (const [testId, description] of [
      ['sign-contract-type-select-individual', SIGN_CONTRACT_TYPE_COPY.individual.description],
      ['sign-contract-type-select-corporate', SIGN_CONTRACT_TYPE_COPY.corporate.description],
    ] as const) {
      const describedBy = query(testId)?.getAttribute('aria-describedby');

      expect(describedBy).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${describedBy}`)?.textContent).toContain(description);
    }
  });

  it('preselects nothing, and cannot be continued until a type is chosen', async () => {
    // A preselection is indistinguishable from a choice once submitted, and which agreement a
    // contributor signs is not a decision this dialog may make on their behalf.
    expect((fixture.componentInstance as any).selectedType()).toBeNull();
    expect(query('sign-contract-type-select-continue')?.querySelector('button')?.disabled).toBe(true);

    continueToSign();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with individual when the contributor picks the Individual Contributor card', async () => {
    await choose('sign-contract-type-select-individual');
    continueToSign();

    expect(close).toHaveBeenCalledWith({ contractType: 'individual' });
  });

  it('closes with corporate when the contributor picks the Corporate Contributor card', async () => {
    await choose('sign-contract-type-select-corporate');
    continueToSign();

    expect(close).toHaveBeenCalledWith({ contractType: 'corporate' });
  });

  it('closes with the later choice when the contributor changes their mind', async () => {
    await choose('sign-contract-type-select-individual');
    await choose('sign-contract-type-select-corporate');
    continueToSign();

    expect(close).toHaveBeenCalledWith({ contractType: 'corporate' });
  });

  it('enables Continue once a card is chosen', async () => {
    await choose('sign-contract-type-select-corporate');

    expect(query('sign-contract-type-select-continue')?.querySelector('button')?.disabled).toBe(false);
  });

  it('closes with null when cancelled', async () => {
    (fixture.componentInstance as any).onCancel();

    expect(close).toHaveBeenCalledWith(null);
  });

  describe('a type the identity already holds', () => {
    // The identity step lets a contributor this far precisely because one type is still unsigned.
    // Offering the type they already hold as freely as the one they need would hand back the
    // redundant signing ceremony the identity gate exists to prevent.

    it('offers a held ICLA as held, and leaves the corporate route open', async () => {
      await setup(['ICLA']);

      expect(query('sign-contract-type-select-individual')?.getAttribute('aria-disabled')).toBe('true');
      expect(query('sign-contract-type-select-corporate')?.getAttribute('aria-disabled')).not.toBe('true');
      expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.alreadyHeld);
    });

    it('offers a held ECLA as held, and leaves the individual route open', async () => {
      await setup(['ECLA']);

      expect(query('sign-contract-type-select-corporate')?.getAttribute('aria-disabled')).toBe('true');
      expect(query('sign-contract-type-select-individual')?.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('refuses the click on the held card, so the form never takes that type', async () => {
      await setup(['ICLA']);
      await choose('sign-contract-type-select-individual');

      expect((fixture.componentInstance as any).selectedType()).toBeNull();
      continueToSign();
      expect(close).not.toHaveBeenCalled();
    });

    it('refuses to submit the held type even when the form is written another way', async () => {
      // The one place the form is written directly, and only to prove the click is not the only
      // thing standing between a held type and the hand-off. A preselection or a form patch
      // reaches `onContinue` with the disabled card never involved, which is why the guard is on
      // the submit path too rather than on the card alone.
      await setup(['ICLA']);
      preselect('individual');
      continueToSign();

      expect(close).not.toHaveBeenCalled();
    });

    it('still closes on the type that is left to sign', async () => {
      await setup(['ICLA']);
      await choose('sign-contract-type-select-corporate');
      continueToSign();

      expect(close).toHaveBeenCalledWith({ contractType: 'corporate' });
    });

    it('disables neither card when the identity holds nothing', async () => {
      await setup([]);

      expect(query('sign-contract-type-select-individual')?.getAttribute('aria-disabled')).not.toBe('true');
      expect(query('sign-contract-type-select-corporate')?.getAttribute('aria-disabled')).not.toBe('true');
    });
  });
});
