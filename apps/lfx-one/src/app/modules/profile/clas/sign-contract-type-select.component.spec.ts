// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { SIGN_CONTRACT_TYPE_COPY } from '@lfx-one/shared/constants';
import type { SignContractTypeDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { SignContractTypeSelectComponent } from './sign-contract-type-select.component';

describe('SignContractTypeSelectComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<SignContractTypeSelectComponent>;

  async function setup(data: Partial<SignContractTypeDialogData> = {}): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [SignContractTypeSelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: { iclaEnabled: true, cclaEnabled: true, ...data } satisfies SignContractTypeDialogData,
          },
        },
      ],
    });

    fixture = TestBed.createComponent(SignContractTypeSelectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('shows both contributor cards and keeps Continue disabled until one is chosen', async () => {
    await setup();

    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.body);
    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.individual.label);
    expect(fixture.nativeElement.textContent).toContain(SIGN_CONTRACT_TYPE_COPY.corporate.label);
    expect(fixture.nativeElement.querySelector('[data-testid="sign-contract-type-select-individual"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="sign-contract-type-select-corporate"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="sign-contract-type-select-continue"] button')?.disabled).toBe(true);
  });

  it('closes with the selected contract type', async () => {
    await setup();

    fixture.componentInstance['selectForm'].controls.contractType.setValue('corporate');
    fixture.detectChanges();
    fixture.componentInstance['onContinue']();

    expect(close).toHaveBeenCalledWith({ contractType: 'corporate' });
  });

  it('closes with null when cancelled', async () => {
    await setup();

    fixture.componentInstance['onCancel']();

    expect(close).toHaveBeenCalledWith(null);
  });
});
