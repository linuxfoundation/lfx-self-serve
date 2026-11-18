// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GROUPS_HOME_DEFAULT_FILTERS } from '@lfx-one/shared/constants';
import { GroupsHomeFilters } from '@lfx-one/shared/interfaces';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GroupsFiltersComponent } from './groups-filters.component';

describe('GroupsFiltersComponent', () => {
  let fixture: ComponentFixture<GroupsFiltersComponent>;
  let emitted: GroupsHomeFilters[];

  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const button = (testId: string): HTMLButtonElement => byTestId(testId)?.querySelector('button') as HTMLButtonElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };
  const render = async (filters: GroupsHomeFilters = GROUPS_HOME_DEFAULT_FILTERS): Promise<void> => {
    fixture = TestBed.createComponent(GroupsFiltersComponent);
    fixture.componentRef.setInput('scopeOptions', [
      { value: 'fdn', label: 'Synthetic Foundation' },
      { value: 'prj', label: 'Synthetic Project' },
    ]);
    fixture.componentRef.setInput('votingCounts', { enabled: 2, disabled: 5 });
    fixture.componentRef.setInput('filters', filters);
    emitted = [];
    fixture.componentInstance.filters.subscribe((value) => emitted.push(value));
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    button('groups-home-filters-button').click();
    await settle();
  };
  const toggleSelect = async (testId: string): Promise<void> => {
    (byTestId(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
    await settle();
  };
  const optionLabels = async (testId: string): Promise<string[]> => {
    await toggleSelect(testId);
    const labels = Array.from(document.querySelectorAll('[data-testid="ui-option"]')).map((option) => option.textContent?.trim() ?? '');
    await toggleSelect(testId);
    return labels;
  };
  const pick = async (testId: string, label: string): Promise<void> => {
    await toggleSelect(testId);
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]'))
      .find((option) => option.textContent?.trim() === label)
      ?.click();
    await settle();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } }],
    });
  });

  afterEach(() => {
    fixture.destroy();
    document.body.innerHTML = '';
  });

  it('lists every foundation and project after the default, and voting with counts', async () => {
    await render();

    expect(await optionLabels('groups-home-filters-scope')).toEqual(['All foundations and projects', 'Synthetic Foundation', 'Synthetic Project']);
    expect(await optionLabels('groups-home-filters-voting')).toEqual(['All voting', 'Voting Enabled (2)', 'Voting Disabled (5)']);
  });

  it('applies the draft only on Apply, which is disabled until the draft changes', async () => {
    await render();
    expect(button('groups-home-filters-apply').disabled).toBe(true);

    await pick('groups-home-filters-scope', 'Synthetic Project');
    await pick('groups-home-filters-voting', 'Voting Enabled (2)');
    expect(emitted).toEqual([]);

    button('groups-home-filters-apply').click();
    await settle();
    expect(emitted).toEqual([{ scope: 'prj', voting: 'enabled' }]);
    expect(byTestId('groups-home-filters-panel')).toBeNull();
  });

  it('counts the applied filters on the button', async () => {
    await render({ scope: 'prj', voting: 'disabled' });

    expect(byTestId('groups-home-filters-count')?.textContent?.trim()).toBe('2');
  });

  it('clears only the draft on Reset Filters', async () => {
    await render({ scope: 'prj', voting: null });

    button('groups-home-filters-reset').click();
    await settle();
    expect(emitted).toEqual([]);
    expect(byTestId('groups-home-filters-reset')).toBeNull();
    expect(button('groups-home-filters-apply').disabled).toBe(false);
  });
});
