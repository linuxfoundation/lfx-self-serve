// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_REDDIT_CUSTOM_AUDIENCES, REDDIT_CUSTOM_AUDIENCE_PICKER_REASONS } from '@lfx-one/shared/constants';
import type { RedditCustomAudiencesDraft, RedditCustomAudiencesResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditCustomAudiencesComponent } from './reddit-custom-audiences.component';

const AUDIENCES: RedditCustomAudiencesResult = {
  accountId: 't2_synthaccount',
  audiences: [{ id: 'aud_registrants', name: 'Past registrants', type: 'CUSTOMER_LIST', status: 'VALID', sizeLower: 12000, sizeUpper: 14100 }],
  truncated: false,
};

// The rules (id shape, overlap, cap) are tested in `campaign-reddit-custom-audiences.utils.spec.ts`; these test the wiring.
describe('RedditCustomAudiencesComponent', () => {
  let fixture: ComponentFixture<RedditCustomAudiencesComponent>;
  let getRedditCustomAudiences: ReturnType<typeof vi.fn<(slug: string) => Observable<RedditCustomAudiencesResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const audiences = (): RedditCustomAudiencesDraft => fixture.componentInstance.audiences();
  // The protected handler, reached the way the template reaches it.
  const addAudience = (key: string, value: string): void => {
    (fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>)['onAddAudience'](key, value, {
      writeValue: vi.fn(),
    } as unknown as UiComboboxComponent);
    fixture.detectChanges();
  };

  function render(enabled: boolean, held: Partial<RedditCustomAudiencesDraft> = {}): void {
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('enabled', enabled);
    fixture.componentRef.setInput('audiences', { ...DEFAULT_REDDIT_CUSTOM_AUDIENCES, ...held });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getRedditCustomAudiences = vi.fn(() => of(AUDIENCES));
    await TestBed.configureTestingModule({
      imports: [RedditCustomAudiencesComponent],
      providers: [{ provide: CampaignService, useValue: { getRedditCustomAudiences } }],
    }).compileComponents();
    fixture = TestBed.createComponent(RedditCustomAudiencesComponent);
  });

  it("lists the ad account's audiences and adds a picked one, refusing it in the other list", () => {
    render(true);

    expect(getRedditCustomAudiences).toHaveBeenCalledWith('tlf');
    addAudience('customAudienceIds', 'aud_registrants');
    expect(audiences().customAudienceIds).toEqual(['aud_registrants']);
    expect(query('reddit-custom-audiences-customAudienceIds-aud_registrants')?.textContent).toContain('Past registrants');

    addAudience('excludedCustomAudienceIds', 'aud_registrants');
    expect(query('reddit-custom-audiences-add-error')?.textContent).toContain('other list');
    expect(audiences().excludedCustomAudienceIds).toEqual([]);
  });

  it('shows nothing and reads nothing without the capability and without picks', () => {
    render(false);

    expect(query('reddit-custom-audiences')).toBeNull();
    expect(getRedditCustomAudiences).not.toHaveBeenCalled();
  });

  it('keeps held picks removable without the capability, offering no box', () => {
    render(false, { excludedCustomAudienceIds: ['aud_old'] });

    expect(query('reddit-custom-audiences-excludedCustomAudienceIds-add')).toBeNull();
    query('reddit-custom-audiences-excludedCustomAudienceIds-remove-aud_old')?.click();
    fixture.detectChanges();
    expect(audiences().excludedCustomAudienceIds).toEqual([]);
  });

  it('keeps the typed boxes when the list cannot be read', () => {
    getRedditCustomAudiences.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(true);

    expect(query('reddit-custom-audiences-picker-unavailable')?.textContent).toContain(REDDIT_CUSTOM_AUDIENCE_PICKER_REASONS.failed);
    addAudience('excludedCustomAudienceIds', 'aud_typed');
    expect(audiences().excludedCustomAudienceIds).toEqual(['aud_typed']);
  });
});
