// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { META_LEAD_FORM_INACTIVE_REFUSAL, META_LEAD_FORM_PICKER_REASONS } from '@lfx-one/shared/constants';
import type { MetaLeadFormsResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaLeadFormPickerComponent } from './meta-lead-form-picker.component';

// The rules (which forms can be picked, how others are labelled) are tested in campaign-meta-lead-form.utils.spec.ts;
// this spec only checks the wiring: the read reaches the picker, a pick reaches the model, a failed read offers the typed box,
// and a held form the read shows as inactive is reported to the tab (#6107).
const FORMS: MetaLeadFormsResult = {
  pageId: '100000000000001',
  forms: [
    { id: '111', name: 'Registrations', status: 'ACTIVE' },
    { id: '222', name: 'Old form', status: 'ARCHIVED' },
  ],
};

describe('MetaLeadFormPickerComponent', () => {
  let fixture: ComponentFixture<MetaLeadFormPickerComponent>;
  let getMetaLeadForms: ReturnType<typeof vi.fn<(slug: string) => Observable<MetaLeadFormsResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const handlers = (): Record<string, (value: string | null) => void> => fixture.componentInstance as unknown as Record<string, (value: string | null) => void>;

  function render(): void {
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('leadFormId', '');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getMetaLeadForms = vi.fn(() => of(FORMS));
    await TestBed.configureTestingModule({
      imports: [MetaLeadFormPickerComponent],
      providers: [{ provide: CampaignService, useValue: { getMetaLeadForms } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MetaLeadFormPickerComponent);
  });

  it("reads the project's forms and lists them in the picker", () => {
    render();
    expect(getMetaLeadForms).toHaveBeenCalledWith('tlf');
    expect(query('meta-lead-form-picker-select')).not.toBeNull();
    // The options live in the select's popup, so the picker state is read rather than the DOM.
    const picker = (fixture.componentInstance as unknown as { picker(): { choices: { label: string; disabled: boolean }[] } }).picker();
    expect(picker.choices).toEqual([
      { value: '111', label: 'Registrations', disabled: false },
      { value: '222', label: 'Old form (archived)', disabled: true },
    ]);
  });

  it('sets the model to the picked form, and clears it for "Choose a lead form"', () => {
    render();
    handlers()['onPick']('111');
    expect(fixture.componentInstance.leadFormId()).toBe('111');
    handlers()['onPick']('');
    expect(fixture.componentInstance.leadFormId()).toBe('');
  });

  it('reports a held form the Page lists as inactive, and shows why', () => {
    const reported: (string | null)[] = [];
    fixture.componentInstance.heldRefusalChange.subscribe((refusal) => reported.push(refusal));
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('leadFormId', '222');
    fixture.detectChanges();

    expect(reported.at(-1)).toBe(META_LEAD_FORM_INACTIVE_REFUSAL);
    expect(query('meta-lead-form-picker-inactive')?.textContent).toContain(META_LEAD_FORM_INACTIVE_REFUSAL);

    handlers()['onPick']('111');
    fixture.detectChanges();
    expect(reported.at(-1)).toBeNull();
    expect(query('meta-lead-form-picker-inactive')).toBeNull();
  });

  it('offers a typed form id when the forms cannot be read', () => {
    getMetaLeadForms.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render();
    expect(query('meta-lead-form-picker-select')).toBeNull();
    expect(query('meta-lead-form-picker-id')?.textContent).toContain(META_LEAD_FORM_PICKER_REASONS.failed);
    handlers()['onType'](' 333 ');
    expect(fixture.componentInstance.leadFormId()).toBe('333');
  });
});
