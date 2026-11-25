// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE } from '@lfx-one/shared/constants';
import type { LinkedInLeadFormsResult, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import { emptyLinkedInObjectiveDraft } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedInLeadFormPickerComponent } from './linkedin-lead-form-picker.component';

// The rules (what is offered, sent and held) are tested in campaign-linkedin-lead-gen-form.utils.spec.ts; this spec only
// checks the wiring: the forms are read for the account named, a pick lands in the draft with its owner, the button
// lands in the draft, and a refused read says why.
describe('LinkedInLeadFormPickerComponent', () => {
  let fixture: ComponentFixture<LinkedInLeadFormPickerComponent>;
  let draft: LinkedInObjectiveDraft;
  let getLinkedInLeadForms: ReturnType<typeof vi.fn<(slug: string, accountId?: string) => Observable<LinkedInLeadFormsResult>>>;

  const picker = (): Record<string, (...args: unknown[]) => void> => fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>;

  beforeEach(async () => {
    getLinkedInLeadForms = vi.fn(() => of({ accountId: '100000002', forms: [{ id: '11', name: 'CFP interest', state: 'PUBLISHED' }] }));
    await TestBed.configureTestingModule({
      imports: [LinkedInLeadFormPickerComponent],
      providers: [{ provide: CampaignService, useValue: { getLinkedInLeadForms } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LinkedInLeadFormPickerComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('accountId', '100000002');
    fixture.componentRef.setInput('owner', 'tlf|100000002');
    fixture.componentRef.setInput('available', true);
    fixture.componentRef.setInput('draft', { ...emptyLinkedInObjectiveDraft(), objective: 'lead_generation' });
    fixture.componentInstance.draft.subscribe((value) => (draft = value));
    fixture.detectChanges();
  });

  it('reads the forms for the account named, and a picked form and button land in the draft', () => {
    expect(getLinkedInLeadForms).toHaveBeenCalledWith('tlf', '100000002');

    picker()['onFormChange']('11');
    picker()['onCallToActionChange']('ATTEND');

    expect(draft).toMatchObject({ leadGenForm: '11', leadGenFormOwner: 'tlf|100000002', leadGenCallToAction: 'ATTEND' });
  });

  it('says why a refused read has nothing to offer', () => {
    getLinkedInLeadForms.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.componentRef.setInput('accountId', '100000003');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="linkedin-lead-form-picker-message"]')?.textContent).toContain(
      LINKEDIN_LEAD_FORMS_RESTRICTED_MESSAGE
    );
  });
});
