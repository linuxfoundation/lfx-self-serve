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
  const response: MyFormationWorkResponse = { formations, items: [] };

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
});
