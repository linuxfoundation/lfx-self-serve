// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETINGS_HOME_DEFAULT_FILTERS } from '@lfx-one/shared/constants';
import { Meeting, MeetingDashboardView, MeetingHomeRow, MeetingsHomeFilters } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingsFiltersComponent } from './meetings-filters.component';

const row = (id: string, meeting: Partial<Meeting>): MeetingHomeRow =>
  ({
    key: id,
    title: id,
    startTime: '2026-11-03T15:00:00Z',
    durationMinutes: 60,
    occurrence: null,
    occurrenceId: null,
    meeting: { id, ...meeting },
  }) as MeetingHomeRow;

const ROWS = [
  row('a', { project_uid: 'p-2', project_name: 'OpenSSF', meeting_type: 'Technical' }),
  row('b', { project_uid: 'p-1', project_name: 'CNCF', meeting_type: 'Board' }),
  row('c', { project_uid: 'p-1', project_name: 'CNCF', meeting_type: 'Technical' }),
];

describe('MeetingsFiltersComponent', () => {
  let fixture: ComponentFixture<MeetingsFiltersComponent>;
  let emitted: MeetingsHomeFilters[];
  let outside: HTMLButtonElement;

  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const button = (testId: string): HTMLButtonElement => byTestId(testId)?.querySelector('button') as HTMLButtonElement;
  const panel = (): HTMLElement | null => byTestId('meetings-home-filters-panel');
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };
  const render = async (filters: MeetingsHomeFilters = MEETINGS_HOME_DEFAULT_FILTERS, tab: MeetingDashboardView = 'upcoming'): Promise<void> => {
    fixture = TestBed.createComponent(MeetingsFiltersComponent);
    fixture.componentRef.setInput('tab', tab);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('filters', filters);
    emitted = [];
    fixture.componentInstance.filters.subscribe((value) => emitted.push(value));
    document.body.appendChild(fixture.nativeElement);
    outside = document.body.appendChild(document.createElement('button'));
    await fixture.whenStable();
  };
  const open = async (): Promise<void> => {
    button('meetings-home-filters-button').click();
    await settle();
  };
  const toggle = async (testId: string): Promise<void> => {
    (byTestId(testId)?.querySelector('input') as HTMLInputElement).click();
    await settle();
  };
  const pick = async (testId: string, label: string): Promise<void> => {
    (byTestId(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
    await settle();
    (
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]')).find((option) => option.textContent?.trim() === label) as HTMLElement
    ).click();
    await settle();
  };
  const optionLabels = async (testId: string): Promise<string[]> => {
    (byTestId(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
    await settle();
    const labels = Array.from(document.querySelectorAll('[data-testid="ui-option"]')).map((option) => option.textContent?.trim() ?? '');
    (byTestId(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
    await settle();
    return labels;
  };

  afterEach(() => {
    fixture.destroy();
    outside.remove();
    vi.restoreAllMocks();
  });

  it('shows the applied-filter count on the button', async () => {
    await render({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-1', organizedByMe: true });

    expect(byTestId('meetings-home-filters-count')?.textContent?.trim()).toBe('2');
    expect(button('meetings-home-filters-button').getAttribute('aria-label')).toBe('Filters, 2 applied');
  });

  it('shows no count while nothing is applied', async () => {
    await render();

    expect(byTestId('meetings-home-filters-count')).toBeNull();
    expect(button('meetings-home-filters-button').getAttribute('aria-label')).toBeNull();
  });

  it('offers Project, Meeting type, RSVP and both switches on Upcoming, with options from the rows', async () => {
    await render();
    await open();

    expect(await optionLabels('meetings-home-filters-project')).toEqual(['All projects', 'CNCF', 'OpenSSF']);
    expect(await optionLabels('meetings-home-filters-type')).toEqual(['All types', 'Board', 'Technical']);
    expect(await optionLabels('meetings-home-filters-rsvp')).toEqual(['Any RSVP', 'Needs response', 'Going', 'Not going', 'Maybe']);
    expect(byTestId('meetings-home-filters-organized')?.textContent).toContain('Organized by me');
    expect(byTestId('meetings-home-filters-hide-declined')?.textContent).toContain('Hide declined meeting series');
  });

  it('offers only Project and Meeting type on Past', async () => {
    await render(MEETINGS_HOME_DEFAULT_FILTERS, 'past');
    await open();

    expect(byTestId('meetings-home-filters-project')).toBeTruthy();
    expect(byTestId('meetings-home-filters-type')).toBeTruthy();
    expect(byTestId('meetings-home-filters-rsvp')).toBeNull();
    expect(byTestId('meetings-home-filters-organized')).toBeNull();
    expect(byTestId('meetings-home-filters-hide-declined')).toBeNull();
  });

  it('keeps edits as a draft and applies them only on Apply, then closes', async () => {
    await render();
    await open();

    expect(button('meetings-home-filters-apply').disabled).toBe(true);
    await toggle('meetings-home-filters-organized');

    expect(emitted).toEqual([]);
    expect(button('meetings-home-filters-apply').disabled).toBe(false);

    button('meetings-home-filters-apply').click();
    await settle();

    expect(emitted).toEqual([{ ...MEETINGS_HOME_DEFAULT_FILTERS, organizedByMe: true }]);
    expect(panel()).toBeNull();
  });

  it('applies picks from the selects, mapping the "All" choices back to no filter', async () => {
    await render();
    await open();
    await pick('meetings-home-filters-project', 'CNCF');
    await pick('meetings-home-filters-rsvp', 'Needs response');

    expect(panel()).toBeTruthy();
    expect(emitted).toEqual([]);

    button('meetings-home-filters-apply').click();
    await settle();
    expect(emitted).toEqual([{ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-1', rsvp: 'pending' }]);

    await open();
    await pick('meetings-home-filters-project', 'All projects');
    button('meetings-home-filters-apply').click();
    await settle();
    expect(emitted[1]).toEqual({ ...MEETINGS_HOME_DEFAULT_FILTERS, rsvp: 'pending' });
  });

  it('disables Apply again once the draft matches the applied filters', async () => {
    await render();
    await open();
    await toggle('meetings-home-filters-hide-declined');
    await toggle('meetings-home-filters-hide-declined');

    expect(button('meetings-home-filters-apply').disabled).toBe(true);
  });

  it('discards the draft on an outside click', async () => {
    await render();
    await open();
    await toggle('meetings-home-filters-organized');

    outside.click();
    await settle();

    expect(panel()).toBeNull();
    expect(emitted).toEqual([]);

    await open();
    expect((byTestId('meetings-home-filters-organized')?.querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect(button('meetings-home-filters-apply').disabled).toBe(true);
  });

  it('shows Reset Filters only when something is set, and it clears everything and closes', async () => {
    await render();
    await open();

    expect(byTestId('meetings-home-filters-reset')).toBeNull();
    await toggle('meetings-home-filters-organized');
    expect(byTestId('meetings-home-filters-reset')).toBeTruthy();

    fixture.componentRef.setInput('filters', { ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-1' });
    await settle();
    button('meetings-home-filters-reset').click();
    await settle();

    expect(emitted).toEqual([MEETINGS_HOME_DEFAULT_FILTERS]);
    expect(panel()).toBeNull();
  });

  it('closes the popover when the tab changes', async () => {
    await render();
    await open();
    expect(panel()).toBeTruthy();

    fixture.componentRef.setInput('tab', 'past');
    await settle();

    expect(panel()).toBeNull();
  });
});
