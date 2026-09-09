// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LensItem } from '@lfx-one/shared/interfaces';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectSelectorComponent } from './project-selector.component';

/**
 * Covers the ordering contract only. Curated mode is used as the harness because it sources items
 * from the `items` input rather than `NavigationService`, which keeps the assertion about *order*
 * free of upstream pagination and debouncing — the browse-vs-search branch under test is shared by
 * both modes. The nav-mode timing rule (order on the term the results were fetched for, not the
 * term the user typed) is covered separately below.
 */
describe('ProjectSelectorComponent ordering', () => {
  // Deliberately not alphabetical, and every entry matches "cloud" so the search assertion is
  // about ordering rather than filtering.
  const items: LensItem[] = [
    { uid: 'u1', slug: 'zeta-cloud', name: 'Zeta Cloud', logoUrl: null, isFoundation: false, formationSubStage: null },
    { uid: 'u2', slug: 'alpha-cloud', name: 'Alpha Cloud', logoUrl: null, isFoundation: false, formationSubStage: null },
    { uid: 'u3', slug: 'mid-cloud', name: 'Mid Cloud', logoUrl: null, isFoundation: false, formationSubStage: null },
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

/**
 * Nav-backed mode, where the typed term and the term the visible items were fetched for diverge
 * across the search debounce and the request round-trip.
 */
describe('ProjectSelectorComponent nav-backed ordering', () => {
  const foundations: LensItem[] = [
    { uid: 'f2', slug: 'zeta-foundation', name: 'Zeta Foundation', logoUrl: null, isFoundation: true, formationSubStage: null },
    { uid: 'f1', slug: 'alpha-foundation', name: 'Alpha Foundation', logoUrl: null, isFoundation: true, formationSubStage: null },
  ];
  const projects: LensItem[] = [
    { uid: 'p2', slug: 'zeta-project', name: 'Zeta Project', logoUrl: null, isFoundation: false, formationSubStage: null },
    { uid: 'p1', slug: 'alpha-project', name: 'Alpha Project', logoUrl: null, isFoundation: false, formationSubStage: null },
  ];

  let fixture: ComponentFixture<ProjectSelectorComponent>;
  let resultsTerm: ReturnType<typeof signal<string>>;

  // Nav mode (unlike curated) runs the sidebar-relative panel alignment on popover show, which
  // reads `window.matchMedia` — absent in jsdom. Reporting no match takes the early return, so the
  // geometry path stays out of an ordering test.
  afterEach(() => vi.unstubAllGlobals());

  async function build(hybrid: boolean): Promise<void> {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    resultsTerm = signal('');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProjectSelectorComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: NavigationService,
          useValue: {
            items: (lens: string) => signal(lens === 'foundation' ? foundations : projects),
            hasMore: () => signal(false),
            loading: () => signal(false),
            // Both lenses are searched with the same term and share this signal, mirroring the
            // parallel dispatch the component performs in hybrid mode.
            resultsTerm: () => resultsTerm,
            setSearchTerm: () => undefined,
            loadNextPage: () => undefined,
          },
        },
        {
          provide: PersonaService,
          useValue: {
            personaProjects: signal({}),
            // Makes p1 a child of f1, so the All tab has something to nest while browsing.
            detectedProjects: signal([{ projectUid: 'p1', parentProjectUid: 'f1', isFoundation: false }]),
            allPersonas: signal([]),
          },
        },
        { provide: ProjectContextService, useValue: { isFoundationContext: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectSelectorComponent);
    fixture.componentRef.setInput('lens', 'project');
    fixture.componentRef.setInput('hybridMode', hybrid);
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('[data-testid="project-selector"]') as HTMLButtonElement).click();
    await fixture.whenStable();
  }

  function renderedSlugs(): string[] {
    return Array.from(document.body.querySelectorAll('[data-testid^="lens-item-"]')).map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('lens-item-', '')
    );
  }

  function nestedSlugs(): string[] {
    return Array.from(document.body.querySelectorAll('[data-testid^="lens-item-"]'))
      .filter((el) => el.parentElement?.classList.contains('pl-5'))
      .map((el) => (el.getAttribute('data-testid') ?? '').replace('lens-item-', ''));
  }

  async function type(term: string): Promise<void> {
    const input = document.body.querySelector('[data-testid="project-search-input"]') as HTMLInputElement;
    input.value = term;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('keeps browse ordering until the search results actually arrive', async () => {
    await build(false);

    // Typed, but NavigationService has not come back yet — the list on screen is still the browse
    // list, so re-ordering it now would reshuffle twice for one search.
    await type('zeta');

    expect(renderedSlugs()).toEqual(['alpha-project', 'zeta-project']);
  });

  it('switches to relevance ordering once the results reflect the search', async () => {
    await build(false);
    await type('zeta');

    resultsTerm.set('zeta');
    await fixture.whenStable();

    expect(renderedSlugs()).toEqual(['zeta-project', 'alpha-project']);
  });

  it('nests projects under their parent foundation on the All tab while browsing', async () => {
    await build(true);

    expect(nestedSlugs()).toEqual(['alpha-project']);
  });

  it('flattens the All tab while searching so a match is not hidden under its parent', async () => {
    await build(true);
    await type('zeta');
    resultsTerm.set('zeta');
    await fixture.whenStable();

    // Foundations still lead — the two lenses are separate queries with non-comparable scores —
    // but each group keeps its own relevance order and nothing is nested out of view (GH-2030).
    expect(nestedSlugs()).toEqual([]);
    expect(renderedSlugs()).toEqual(['zeta-foundation', 'alpha-foundation', 'zeta-project', 'alpha-project']);
  });
});
