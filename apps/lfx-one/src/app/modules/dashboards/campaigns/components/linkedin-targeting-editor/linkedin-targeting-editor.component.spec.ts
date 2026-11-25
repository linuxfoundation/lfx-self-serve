// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { LINKEDIN_TARGETING_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type { LinkedInTargetingDraft, LinkedInTargetingSearchFacet, LinkedInTargetingSearchResult } from '@lfx-one/shared/interfaces';
import { emptyLinkedInTargetingDraft } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedInTargetingFacetGroupComponent } from '../linkedin-targeting-facet-group/linkedin-targeting-facet-group.component';
import { LinkedInTargetingEditorComponent } from './linkedin-targeting-editor.component';

// The rules (which facets a group may add, the caps, the payload, the refusal) are tested in
// campaign-linkedin-targeting-form.utils.spec.ts; this spec only checks the wiring: a typed query reaches the search
// after the debounce, a search or fixed-list pick reaches the draft, and the refusal is shown.
const RESULT: LinkedInTargetingSearchResult = { facet: 'skills', entities: [{ urn: 'urn:li:skill:1', name: 'Go' }] };

describe('LinkedInTargetingEditorComponent', () => {
  let fixture: ComponentFixture<LinkedInTargetingEditorComponent>;
  let draft: LinkedInTargetingDraft;
  let searchLinkedInTargeting: ReturnType<
    typeof vi.fn<(slug: string, facet: LinkedInTargetingSearchFacet, q: string) => Observable<LinkedInTargetingSearchResult>>
  >;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  /** The first clause's group, whose protected handlers stand in for the autocomplete and select events. */
  const clause = (): Record<string, (...args: unknown[]) => void> =>
    fixture.debugElement.query(By.directive(LinkedInTargetingFacetGroupComponent)).componentInstance as Record<string, (...args: unknown[]) => void>;

  beforeEach(async () => {
    vi.useFakeTimers();
    searchLinkedInTargeting = vi.fn(() => of(RESULT));
    await TestBed.configureTestingModule({
      imports: [LinkedInTargetingEditorComponent],
      providers: [{ provide: CampaignService, useValue: { searchLinkedInTargeting } }],
    }).compileComponents();
    fixture = TestBed.createComponent(LinkedInTargetingEditorComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('draft', emptyLinkedInTargetingDraft());
    fixture.componentInstance.draft.subscribe((value) => (draft = value));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('shows why the clauses cannot be sent until one holds a value', () => {
    expect(query('linkedin-targeting-editor-error')?.textContent).toContain('Add at least one included targeting clause.');
    fixture.componentRef.setInput('draft', { clauses: [{ skills: [{ urn: 'urn:li:skill:1', name: 'Go' }] }], exclude: {} });
    fixture.detectChanges();
    expect(query('linkedin-targeting-editor-error')).toBeNull();
  });
});
