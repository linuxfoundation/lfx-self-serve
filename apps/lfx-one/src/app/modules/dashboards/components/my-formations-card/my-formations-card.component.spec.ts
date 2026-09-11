// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { MyFormationSummary, MyFormationWorkResponse } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { FormationService } from '@services/formation.service';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { MyFormationsCardComponent } from './my-formations-card.component';

function rowNames(fixture: ComponentFixture<MyFormationsCardComponent>): string[] {
  return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="me-formations-card-row-"]')).map(
    (row) => (row as HTMLElement).getAttribute('data-testid') ?? ''
  );
}

const formation = (overrides: Partial<MyFormationSummary> = {}): MyFormationSummary => ({
  formation_uid: 'formation-1',
  project_uid: 'project-1',
  project_slug: 'acme-project',
  project_name: 'Acme Project',
  sub_stage: 'exploratory',
  announcement_date: null,
  assigned_to_do: 1,
  assigned_with_team: 0,
  assigned_done: 0,
  assigned_skipped: 0,
  items_done: 0,
  items_total: 2,
  gating_done: 0,
  gating_total: 1,
  blocking_item_title: null,
  ...overrides,
});

async function render(formations: MyFormationSummary[], flagEnabled = true): Promise<ComponentFixture<MyFormationsCardComponent>> {
  const response: MyFormationWorkResponse = { formations, items: [], data_source: 'fixture' };

  await TestBed.configureTestingModule({
    imports: [MyFormationsCardComponent],
    providers: [
      provideRouter([]),
      { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(flagEnabled) } },
      { provide: FormationService, useValue: { getMyFormationWork: vi.fn().mockReturnValue(of(response)) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MyFormationsCardComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('MyFormationsCardComponent (GH-1956)', () => {
  it('renders a single formation as the card body (N=1)', async () => {
    const fixture = await render([formation()]);

    expect(fixture.nativeElement.querySelector('[data-testid="me-formations-card"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="me-formations-card-row-"]')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('1 to do');
  });

  it('renders multiple formations as sibling rows (N=3)', async () => {
    const fixture = await render([
      formation({ formation_uid: 'formation-1' }),
      formation({ formation_uid: 'formation-2' }),
      formation({ formation_uid: 'formation-3' }),
    ]);

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="me-formations-card-row-"]')).toHaveLength(3);
  });

  it('renders nothing when there are no formations', async () => {
    const fixture = await render([]);

    expect(fixture.nativeElement.querySelector('[data-testid="me-formations-card"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="me-formations-card-loading"]')).toBeNull();
  });

  it('renders nothing when the flag is off, even with formations in the response', async () => {
    const fixture = await render([formation()], false);

    expect(fixture.nativeElement.querySelector('[data-testid="me-formations-card"]')).toBeNull();
  });

  it('renders exactly the cap (N=5) with no toggle', async () => {
    const fixture = await render([
      formation({ formation_uid: 'formation-1' }),
      formation({ formation_uid: 'formation-2' }),
      formation({ formation_uid: 'formation-3' }),
      formation({ formation_uid: 'formation-4' }),
      formation({ formation_uid: 'formation-5' }),
    ]);

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="me-formations-card-row-"]')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('[data-testid="me-formations-card-toggle"]')).toBeNull();
  });

  it('caps at 5 above the cap (N=6), keeping the highest-priority 5 visible, then expands and collapses back', async () => {
    const fixture = await render([
      formation({ formation_uid: 'formation-1', assigned_to_do: 1 }),
      formation({ formation_uid: 'formation-2', assigned_to_do: 1 }),
      formation({ formation_uid: 'formation-3', assigned_to_do: 1 }),
      formation({ formation_uid: 'formation-4', assigned_to_do: 1 }),
      formation({ formation_uid: 'formation-5', assigned_to_do: 1 }),
      formation({ formation_uid: 'formation-6-top-priority', assigned_to_do: 9, blocking_item_title: 'Waiting on legal' }),
    ]);

    const visibleRows = () => rowNames(fixture);

    expect(visibleRows()).toHaveLength(5);
    expect(visibleRows()).toContain('me-formations-card-row-formation-6-top-priority');
    expect(visibleRows()).not.toContain('me-formations-card-row-formation-5');

    const toggle = fixture.nativeElement.querySelector('[data-testid="me-formations-card-toggle"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Show all 6');

    toggle.click();
    fixture.detectChanges();

    expect(visibleRows()).toHaveLength(6);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Show fewer');

    toggle.click();
    fixture.detectChanges();

    expect(visibleRows()).toHaveLength(5);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('orders rows by most assigned_to_do first, blocked before unblocked, then nearer announcement_date, then name', async () => {
    // Deliberately fed out of order — the wrong-order fixture the ordering rule must correct.
    const fixture = await render([
      formation({ formation_uid: 'few-todo', project_name: 'Few Todo', assigned_to_do: 1, announcement_date: '2026-01-01' }),
      formation({
        formation_uid: 'unblocked-far',
        project_name: 'Unblocked Far',
        assigned_to_do: 3,
        blocking_item_title: null,
        announcement_date: '2026-12-01',
      }),
      formation({
        formation_uid: 'blocked-near',
        project_name: 'Blocked Near',
        assigned_to_do: 3,
        blocking_item_title: 'Waiting on legal',
        announcement_date: '2026-06-01',
      }),
      formation({ formation_uid: 'b-name', project_name: 'B Name', assigned_to_do: 3, blocking_item_title: 'x', announcement_date: null }),
      formation({ formation_uid: 'a-name', project_name: 'A Name', assigned_to_do: 3, blocking_item_title: 'x', announcement_date: null }),
    ]);

    expect(rowNames(fixture)).toEqual([
      'me-formations-card-row-blocked-near',
      'me-formations-card-row-a-name',
      'me-formations-card-row-b-name',
      'me-formations-card-row-unblocked-far',
      'me-formations-card-row-few-todo',
    ]);
  });
});
