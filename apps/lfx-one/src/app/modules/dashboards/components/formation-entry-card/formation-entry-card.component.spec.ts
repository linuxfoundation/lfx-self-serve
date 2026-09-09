// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormationChecklistResponse, FormationItem, ProjectContext } from '@lfx-one/shared/interfaces';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationEntryCardComponent } from './formation-entry-card.component';

/** Only the fields `deriveFormationReadinessSummary` reads — the rest is irrelevant to this component. */
function buildItem(overrides: Partial<FormationItem>): FormationItem {
  return {
    uid: 'formation-item:test',
    formation_uid: 'formation:test',
    template_item_key: 'test-item',
    section_key: 'legal',
    section_title: 'Legal and entity',
    title: 'Test item',
    status: 'not_started',
    is_gating: false,
    owner_team: null,
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    links: [],
    sub_items: [],
    skip_reason: null,
    can_complete: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('FormationEntryCardComponent', () => {
  let fixture: ComponentFixture<FormationEntryCardComponent>;
  let getProjectFormation: ReturnType<typeof vi.fn>;
  const activeContext = signal<ProjectContext | null>({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });

  const render = async (): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [FormationEntryCardComponent],
      providers: [
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext } },
        { provide: FormationService, useValue: { getProjectFormation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationEntryCardComponent);
    await fixture.whenStable();
  };

  const summaryText = (): string | null => fixture.nativeElement.querySelector('[data-testid="formation-entry-card-summary"]')?.textContent ?? null;

  /** `deriveFormationReadinessSummary` reads `response.formation.announcement_date` — every mock response needs the shape. */
  const buildResponse = (items: FormationItem[]): FormationChecklistResponse =>
    ({ items, formation: { announcement_date: null } }) as unknown as FormationChecklistResponse;

  beforeEach(() => {
    activeContext.set({ uid: 'proj-1', name: 'Test Project', slug: 'test-project' });
    getProjectFormation = vi.fn();
  });

  it('renders the done/total count and the open/total gating count', async () => {
    const items = [
      buildItem({ uid: '1', status: 'done', is_gating: true }),
      buildItem({ uid: '2', status: 'not_started', is_gating: true }),
      buildItem({ uid: '3', status: 'not_started', is_gating: false }),
    ];
    getProjectFormation.mockReturnValue(of(buildResponse(items)));

    await render();

    const text = summaryText();
    expect(text).toContain('1 of 3 done');
    // Regression guard: one of two gating items is still open — this must read "1 of 2", never
    // the inverted "1 of 2" flipped to totalGating - openGating (a bug this spec caught once).
    expect(text).toContain('1 of 2 required for Active open');
  });

  it('omits the gating clause entirely when the formation has no gating items', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: false })];
    getProjectFormation.mockReturnValue(of(buildResponse(items)));

    await render();

    expect(summaryText()).not.toContain('required for Active open');
  });

  it('shows 0 of N open when every gating item is already resolved', async () => {
    const items = [buildItem({ uid: '1', status: 'done', is_gating: true }), buildItem({ uid: '2', status: 'skipped', is_gating: true })];
    getProjectFormation.mockReturnValue(of(buildResponse(items)));

    await render();

    expect(summaryText()).toContain('0 of 2 required for Active open');
  });

  it('links to the formation route with the active project slug as a query param', async () => {
    getProjectFormation.mockReturnValue(of({ items: [] } as unknown as FormationChecklistResponse));

    await render();

    const link = fixture.nativeElement.querySelector('[data-testid="formation-entry-card-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/project/formation?project=test-project');
  });

  it('shows an error state instead of a misleading "0 of 0 done" when the fetch fails', async () => {
    getProjectFormation.mockReturnValue(throwError(() => new Error('network error')));

    await render();

    expect(summaryText()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="formation-entry-card-error"]')?.textContent).toContain("Couldn't load the checklist status");
  });
});
