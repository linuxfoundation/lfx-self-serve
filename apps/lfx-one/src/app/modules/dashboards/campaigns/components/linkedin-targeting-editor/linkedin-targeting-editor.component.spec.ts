// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS,
} from '@lfx-one/shared/constants';
import type { LinkedInAudiencesResult, LinkedInTargetingDraft, LinkedInTargetingSearchFacet, LinkedInTargetingSearchResult } from '@lfx-one/shared/interfaces';
import { emptyLinkedInTargetingDraft } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedInTargetingFacetGroupComponent } from '../linkedin-targeting-facet-group/linkedin-targeting-facet-group.component';
import { LinkedInTargetingEditorComponent } from './linkedin-targeting-editor.component';

// The rules (which facets a group may add, the caps, the payload, the refusal) are tested in
// campaign-linkedin-targeting-form.utils.spec.ts; this spec only checks the wiring: a typed query reaches the search
// after the debounce, a search, fixed-list or segment pick reaches the draft, the segments are read once for the
// account named and again on "Try again", and the refusal is shown.
const RESULT: LinkedInTargetingSearchResult = { facet: 'skills', entities: [{ urn: 'urn:li:skill:1', name: 'Go' }] };
const AUDIENCES: LinkedInAudiencesResult = {
  accountId: '100000002',
  audiences: [{ urn: 'urn:li:adSegment:7', name: 'Site visitors', facet: 'dynamicSegments', type: 'WEBSITE', status: 'READY', approximateMemberCount: null }],
};

describe('LinkedInTargetingEditorComponent', () => {
  let fixture: ComponentFixture<LinkedInTargetingEditorComponent>;
  let draft: LinkedInTargetingDraft;
  let searchLinkedInTargeting: ReturnType<
    typeof vi.fn<(slug: string, facet: LinkedInTargetingSearchFacet, q: string) => Observable<LinkedInTargetingSearchResult>>
  >;
  let getLinkedInAudiences: ReturnType<typeof vi.fn<(slug: string, accountId?: string) => Observable<LinkedInAudiencesResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  /** The first clause's group, whose protected handlers stand in for the autocomplete and select events. */
  const clause = (): Record<string, (...args: unknown[]) => void> =>
    fixture.debugElement.query(By.directive(LinkedInTargetingFacetGroupComponent)).componentInstance as Record<string, (...args: unknown[]) => void>;

  beforeEach(async () => {
    vi.useFakeTimers();
    searchLinkedInTargeting = vi.fn(() => of(RESULT));
    getLinkedInAudiences = vi.fn(() => of(AUDIENCES));
    await TestBed.configureTestingModule({
      imports: [LinkedInTargetingEditorComponent],
      providers: [{ provide: CampaignService, useValue: { searchLinkedInTargeting, getLinkedInAudiences } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LinkedInTargetingEditorComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('accountId', '100000002');
    fixture.componentRef.setInput('draft', emptyLinkedInTargetingDraft());
    fixture.componentInstance.draft.subscribe((value) => (draft = value));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('searches the chosen facet after the debounce, and a picked answer lands in the clause as a chip', async () => {
    clause()['onSearch']({ query: '  golang ', originalEvent: new Event('input') });
    await vi.advanceTimersByTimeAsync(LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS);
    fixture.detectChanges();
    expect(searchLinkedInTargeting).toHaveBeenCalledWith('tlf', 'skills', 'golang');

    clause()['onSearchSelect']({ value: RESULT.entities[0], originalEvent: new Event('click') });
    fixture.detectChanges();
    expect(draft.clauses[0]).toEqual({ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] });
    expect(query('linkedin-targeting-editor-clause-0-facets-skills-urn:li:skill:1')?.textContent).toContain('Go');
  });

  it('adds a fixed-list value to the clause from the facet chosen', () => {
    clause()['onFacetChange']('seniorities');
    clause()['onStaticPick']('urn:li:seniority:4');
    fixture.detectChanges();
    expect(draft.clauses[0]).toEqual({ seniorities: [{ urn: 'urn:li:seniority:4', name: 'Senior' }] });
    expect(searchLinkedInTargeting).not.toHaveBeenCalled();
  });

  it('reads the segments once for the account named, for every group, and adds a picked one to the clause', () => {
    expect(getLinkedInAudiences).toHaveBeenCalledTimes(1);
    expect(getLinkedInAudiences).toHaveBeenCalledWith('tlf', '100000002');

    clause()['onFacetChange']('dynamicSegments');
    clause()['onStaticPick']('urn:li:adSegment:7');
    fixture.detectChanges();
    expect(draft.clauses[0]).toEqual({ dynamicSegments: [{ urn: 'urn:li:adSegment:7', name: 'Site visitors' }] });
    expect(getLinkedInAudiences).toHaveBeenCalledTimes(1);
  });

  it('says why a segment read failed, and reads again on Try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getLinkedInAudiences.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 503, error: { code: LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE } }))
    );
    fixture.componentRef.setInput('accountId', null);
    clause()['onFacetChange']('dynamicSegments');
    fixture.detectChanges();
    expect(getLinkedInAudiences).toHaveBeenLastCalledWith('tlf', undefined);
    expect(query('linkedin-targeting-editor-clause-0-facets-segment-message')?.textContent).toContain(LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE);
    expect(query('linkedin-targeting-editor-clause-0-facets-segment')).toBeNull();

    query('linkedin-targeting-editor-clause-0-facets-segment-retry')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(getLinkedInAudiences).toHaveBeenCalledTimes(3);
    expect(query('linkedin-targeting-editor-clause-0-facets-segment')).not.toBeNull();
    expect(query('linkedin-targeting-editor-clause-0-facets-segment-message')).toBeNull();
  });

  it('shows why the clauses cannot be sent until one holds a value', () => {
    expect(query('linkedin-targeting-editor-error')?.textContent).toContain('Add at least one included targeting clause.');
    fixture.componentRef.setInput('draft', { clauses: [{ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] }], exclude: {} });
    fixture.detectChanges();
    expect(query('linkedin-targeting-editor-error')).toBeNull();
  });
});
