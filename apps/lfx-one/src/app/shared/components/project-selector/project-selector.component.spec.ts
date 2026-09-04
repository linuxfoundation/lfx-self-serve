// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LensItem } from '@lfx-one/shared/interfaces';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProjectSelectorComponent } from './project-selector.component';

/**
 * Covers the ordering contract only. Curated mode is used as the harness because it sources items
 * from the `items` input rather than `NavigationService`, which keeps the assertion about *order*
 * free of upstream pagination — the browse-vs-search branch under test is shared by both modes.
 */
describe('ProjectSelectorComponent ordering', () => {
  // Deliberately not alphabetical, and every entry matches "cloud" so the search assertion is
  // about ordering rather than filtering.
  const items: LensItem[] = [
    { uid: 'u1', slug: 'zeta-cloud', name: 'Zeta Cloud', logoUrl: null, isFoundation: false },
    { uid: 'u2', slug: 'alpha-cloud', name: 'Alpha Cloud', logoUrl: null, isFoundation: false },
    { uid: 'u3', slug: 'mid-cloud', name: 'Mid Cloud', logoUrl: null, isFoundation: false },
  ];

  let fixture: ComponentFixture<ProjectSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectSelectorComponent],
      providers: [
        // The list renders inside a PrimeNG popover, which declares animation metadata.
        provideNoopAnimations(),
        // Curated mode short-circuits every NavigationService read, but the component still injects
        // it — these stubs exist to satisfy the injector, not to be exercised.
        {
          provide: NavigationService,
          useValue: {
            items: () => signal<LensItem[]>([]),
            hasMore: () => signal(false),
            loading: () => signal(false),
            setSearchTerm: () => undefined,
            loadNextPage: () => undefined,
          },
        },
        // No persona grants: every item lands in the same role tier, so browse order collapses to
        // the alphabetical tie-break and the two orderings are cleanly distinguishable.
        // `allPersonas` backs the role-badge fallback and is read for every rendered row.
        { provide: PersonaService, useValue: { personaProjects: signal({}), detectedProjects: signal([]), allPersonas: signal([]) } },
        { provide: ProjectContextService, useValue: { isFoundationContext: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectSelectorComponent);
    fixture.componentRef.setInput('lens', 'project');
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();

    // The list lives inside a PrimeNG popover that renders lazily into document.body.
    (fixture.nativeElement.querySelector('[data-testid="project-selector"]') as HTMLButtonElement).click();
    await fixture.whenStable();
  });

  function renderedSlugs(): string[] {
    return Array.from(document.body.querySelectorAll('[data-testid^="lens-item-"]')).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('lens-item-', '')
    );
  }

  async function search(term: string): Promise<void> {
    const input = document.body.querySelector('[data-testid="project-search-input"]') as HTMLInputElement;
    input.value = term;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('sorts alphabetically while browsing', () => {
    expect(renderedSlugs()).toEqual(['alpha-cloud', 'mid-cloud', 'zeta-cloud']);
  });

  it('preserves the source order while searching', async () => {
    // The source order is relevance for nav-backed search (`sort: 'best_match'`). Re-sorting
    // alphabetically here would bury the closest match under every other match (GH-2030).
    await search('cloud');

    expect(renderedSlugs()).toEqual(['zeta-cloud', 'alpha-cloud', 'mid-cloud']);
  });

  it('returns to alphabetical order once the search is cleared', async () => {
    await search('cloud');
    await search('');

    expect(renderedSlugs()).toEqual(['alpha-cloud', 'mid-cloud', 'zeta-cloud']);
  });
});
