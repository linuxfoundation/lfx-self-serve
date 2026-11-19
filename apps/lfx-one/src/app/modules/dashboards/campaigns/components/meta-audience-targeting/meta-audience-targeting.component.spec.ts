// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_META_AUDIENCE_TARGETING, META_CUSTOM_AUDIENCE_PICKER_REASONS } from '@lfx-one/shared/constants';
import type { MetaAudienceTargetingDraft, MetaCustomAudiencesResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaAudienceTargetingComponent } from './meta-audience-targeting.component';

const AUDIENCES: MetaCustomAudiencesResult = {
  accountId: 'act_100000001',
  audiences: [
    {
      id: '23850000000000001',
      name: 'Past registrants',
      subtype: 'CUSTOM',
      description: null,
      approximateCountLowerBound: 12000,
      approximateCountUpperBound: 14100,
    },
    {
      id: '23850000000000002',
      name: 'Lookalike of attendees',
      subtype: 'LOOKALIKE',
      description: null,
      approximateCountLowerBound: null,
      approximateCountUpperBound: null,
    },
  ],
  truncated: false,
};

describe('MetaAudienceTargetingComponent', () => {
  let fixture: ComponentFixture<MetaAudienceTargetingComponent>;
  let getMetaCustomAudiences: ReturnType<typeof vi.fn<(slug: string) => Observable<MetaCustomAudiencesResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const targeting = (): MetaAudienceTargetingDraft => fixture.componentInstance.targeting();
  // The protected handlers, reached the way the template reaches them.
  const handlers = (): Record<string, (...args: unknown[]) => void> => fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>;

  function render(customAudiencesEnabled: boolean, draft: Partial<MetaAudienceTargetingDraft> = {}): void {
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('customAudiencesEnabled', customAudiencesEnabled);
    fixture.componentRef.setInput('targeting', { ...DEFAULT_META_AUDIENCE_TARGETING, ...draft });
    fixture.detectChanges();
  }

  function addAudience(key: string, value: string): void {
    handlers()['onAddAudience'](key, value, { writeValue: vi.fn() } as unknown as UiComboboxComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getMetaCustomAudiences = vi.fn(() => of(AUDIENCES));
    await TestBed.configureTestingModule({
      imports: [MetaAudienceTargetingComponent],
      providers: [{ provide: CampaignService, useValue: { getMetaCustomAudiences } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MetaAudienceTargetingComponent);
  });

  it('shows age, gender and Advantage+ to every campaign manager, and no custom audiences without the relation', () => {
    render(false);

    expect(query('meta-audience-targeting-age-min')).not.toBeNull();
    expect(query('meta-audience-targeting-gender-male')).not.toBeNull();
    expect(query('meta-audience-targeting-advantage')).not.toBeNull();
    expect(query('meta-audience-targeting-custom-audiences')).toBeNull();
    expect(getMetaCustomAudiences).not.toHaveBeenCalled();
  });

  it('writes the age range, a gender and Advantage+ back into the draft', () => {
    render(false);

    handlers()['onAge']('ageMin', '25');
    handlers()['onAge']('ageMax', '44');
    (query('meta-audience-targeting-gender-female')?.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();

    expect(targeting()).toMatchObject({ ageMin: 25, ageMax: 44, genders: ['female'] });
  });

  it('leaves Advantage+ unsaid until the box is touched, then records an untick as an explicit no', () => {
    render(false);
    const box = (): HTMLInputElement => query('meta-audience-targeting-advantage')?.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect('advantageAudience' in targeting()).toBe(false);
    expect(box().checked).toBe(false);

    box().click();
    fixture.detectChanges();
    expect(targeting().advantageAudience).toBe(true);

    box().click();
    fixture.detectChanges();
    expect(targeting().advantageAudience).toBe(false);
  });

  it('shows the refusal the create route would give', () => {
    render(false, { ageMin: 30, advantageAudience: true });

    expect(query('meta-audience-targeting-error')?.textContent).toContain('Advantage+ audience');
  });

  it("lists the ad account's audiences and adds a picked one to the include list", () => {
    render(true);

    expect(getMetaCustomAudiences).toHaveBeenCalledWith('tlf');
    addAudience('customAudiences', '23850000000000001');

    expect(targeting().customAudiences).toEqual(['23850000000000001']);
    expect(query('meta-audience-targeting-customAudiences-23850000000000001')?.textContent).toContain('Past registrants');
  });

  it('refuses a typed id that is not an audience id, or one already in the other list', () => {
    render(true, { customAudiences: ['23850000000000001'] });

    addAudience('excludedCustomAudiences', 'act_1');
    expect(query('meta-audience-targeting-add-error')?.textContent).toContain('digits');

    addAudience('excludedCustomAudiences', '23850000000000001');
    expect(query('meta-audience-targeting-add-error')?.textContent).toContain('other list');
    expect(targeting().excludedCustomAudiences).toEqual([]);
  });

  it('says so when the ad account has no audiences, keeping the typed box', () => {
    getMetaCustomAudiences.mockReturnValue(of({ ...AUDIENCES, audiences: [] }));
    render(true);

    expect(query('meta-audience-targeting-picker-empty')).not.toBeNull();
    expect(query('meta-audience-targeting-customAudiences-add')).not.toBeNull();
  });

  it('keeps held picks removable for a caller without the relation, offering no box and reading nothing', () => {
    render(false, { excludedCustomAudiences: ['23850000000000001'] });

    expect(query('meta-audience-targeting-excludedCustomAudiences-add')).toBeNull();
    expect(getMetaCustomAudiences).not.toHaveBeenCalled();
    query('meta-audience-targeting-excludedCustomAudiences-remove-23850000000000001')?.click();
    fixture.detectChanges();
    expect(targeting().excludedCustomAudiences).toEqual([]);
  });

  it('keeps the typed boxes when the list cannot be read', () => {
    getMetaCustomAudiences.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(true);

    expect(query('meta-audience-targeting-picker-unavailable')?.textContent).toContain(META_CUSTOM_AUDIENCE_PICKER_REASONS.failed);
    addAudience('excludedCustomAudiences', '23850000000000009');
    expect(targeting().excludedCustomAudiences).toEqual(['23850000000000009']);

    handlers()['onRemoveAudience']('excludedCustomAudiences', '23850000000000009');
    expect(targeting().excludedCustomAudiences).toEqual([]);
  });
});
