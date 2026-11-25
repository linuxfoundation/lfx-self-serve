// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LINKEDIN_CONVERSIONS_FAILED_MESSAGE, LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE } from '@lfx-one/shared/constants';
import type { LinkedInConversionsResult, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import { emptyLinkedInObjectiveDraft, linkedInTargetCostInputError } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedInObjectivePickerComponent } from './linkedin-objective-picker.component';

// The rules (what is sent, when Create waits, what the picker offers and says) are tested in
// campaign-linkedin-objective-form.utils.spec.ts; this spec only checks the wiring: a choice reaches the draft, the
// rules are read for the account named only once conversions is chosen, a picked rule reaches the draft with its owner,
// and a refused or failed read says why (with Try again for a failure). The target cost's rules are in
// campaign-linkedin-target-cost.utils.spec.ts; here only that it shows while offered, reaches the draft and says why.
const RESULT: LinkedInConversionsResult = { accountId: '100000002', conversions: [{ id: '104012', name: 'Registration', type: 'REGISTRATION' }] };

describe('LinkedInObjectivePickerComponent', () => {
  let fixture: ComponentFixture<LinkedInObjectivePickerComponent>;
  let draft: LinkedInObjectiveDraft;
  let getLinkedInConversions: ReturnType<typeof vi.fn<(slug: string, accountId?: string) => Observable<LinkedInConversionsResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const picker = (): Record<string, (...args: unknown[]) => void> => fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>;

  beforeEach(async () => {
    getLinkedInConversions = vi.fn(() => of(RESULT));
    await TestBed.configureTestingModule({
      imports: [LinkedInObjectivePickerComponent],
      providers: [{ provide: CampaignService, useValue: { getLinkedInConversions } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LinkedInObjectivePickerComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('accountId', '100000002');
    fixture.componentRef.setInput('owner', 'tlf|100000002');
    fixture.componentRef.setInput('available', true);
    fixture.componentRef.setInput('draft', emptyLinkedInObjectiveDraft());
    fixture.componentInstance.draft.subscribe((value) => (draft = value));
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads the rules for the account named once conversions is chosen, and a picked rule lands in the draft with its owner', () => {
    expect(getLinkedInConversions).not.toHaveBeenCalled();
    picker()['onObjectiveChange']('conversions');
    fixture.detectChanges();
    expect(draft.objective).toBe('conversions');
    expect(getLinkedInConversions).toHaveBeenCalledWith('tlf', '100000002');

    picker()['onAdd']('104012');
    fixture.detectChanges();
    expect(getLinkedInConversions).toHaveBeenCalledTimes(1);
    expect(draft).toEqual({ objective: 'conversions', conversions: ['104012'], conversionsOwner: 'tlf|100000002' });
    expect(query('linkedin-objective-picker-conversion-104012')?.textContent).toContain('Registration');
    expect(query('linkedin-objective-picker-add')).toBeNull();

    picker()['onObjectiveChange']('');
    expect(draft.objective).toBeNull();
  });

  it('offers the target cost only while told to, and a typed value reaches the draft with the shared rule saying why', () => {
    expect(query('linkedin-objective-picker-target-cost')).toBeNull();
    fixture.componentRef.setInput('targetCostOffered', true);
    fixture.detectChanges();
    const field = query('linkedin-objective-picker-target-cost')?.querySelector('input') as HTMLInputElement;
    field.value = '17.885';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(draft.targetCost).toBe('17.885');
    expect(query('linkedin-objective-picker-target-cost')?.textContent).toContain(linkedInTargetCostInputError('17.885', true));

    field.value = '';
    field.dispatchEvent(new Event('input'));
    expect(draft).toEqual(emptyLinkedInObjectiveDraft());
  });

  it('says the rules are for the LF marketing team on a 403, with no select', () => {
    getLinkedInConversions.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    picker()['onObjectiveChange']('conversions');
    fixture.detectChanges();
    expect(query('linkedin-objective-picker-message')?.textContent).toContain(LINKEDIN_CONVERSIONS_RESTRICTED_MESSAGE);
    expect(query('linkedin-objective-picker-add')).toBeNull();
    expect(query('linkedin-objective-picker-retry')).toBeNull();
  });

  it('says why a read failed, and reads again on Try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getLinkedInConversions.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    picker()['onObjectiveChange']('conversions');
    fixture.detectChanges();
    expect(query('linkedin-objective-picker-message')?.textContent).toContain(LINKEDIN_CONVERSIONS_FAILED_MESSAGE);

    query('linkedin-objective-picker-retry')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(getLinkedInConversions).toHaveBeenCalledTimes(2);
    expect(query('linkedin-objective-picker-message')).toBeNull();
    expect(query('linkedin-objective-picker-add')).not.toBeNull();
  });
});
