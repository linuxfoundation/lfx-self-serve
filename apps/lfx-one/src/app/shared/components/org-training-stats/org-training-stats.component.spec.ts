// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ORG_TRAINING_NO_ROSTER_NOTE, ORG_TRAINING_STAT_DEFINITIONS, ORG_TRAINING_STAT_PRIMARY_KEYS, ORG_TRAINING_STAT_TILES } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgTrainingStatsComponent } from './org-training-stats.component';

const STATS: OrgTrainingStats = {
  range: '730d',
  asOf: '2026-10-30T09:48:21.094Z',
  rosterMembers: 17000,
  rosterMembersAsOf: '2026-11-01T00:00:00.000Z',
  peopleWithTrainingActivity: 4199,
  learnersOutsidePeopleList: 216,
  coursesTaken: 9660,
  certifications: 1134,
  certifiedPeople: 857,
  trainingsCompleted: 2373,
  completionRatePct: 36,
  coursesInProgress: 6153,
  peopleInTraining: 3093,
};

describe('OrgTrainingStatsComponent', () => {
  let fixture: ComponentFixture<OrgTrainingStatsComponent>;

  const el = (): HTMLElement => fixture.nativeElement;
  const tile = (testId: string): HTMLElement => el().querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
  const text = (testId: string, part: 'value' | 'label' | 'caption'): string =>
    el().querySelector(`[data-testid="${testId}-${part}"]`)?.textContent?.trim() ?? '';

  function render(stats: OrgTrainingStats | null, range: OrgLensTimeRange): void {
    fixture.componentRef.setInput('stats', stats);
    fixture.componentRef.setInput('range', range);
    fixture.detectChanges();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(OrgTrainingStatsComponent);
  });

  it('renders every tile in order with its label from the shared definitions', () => {
    render(STATS, '730d');

    const rendered = [...el().querySelectorAll('[data-testid^="org-training-stat-"][role="note"]')].map((node) => node.getAttribute('data-testid'));
    expect(rendered).toEqual(ORG_TRAINING_STAT_TILES.map((layout) => layout.testId));
    for (const layout of ORG_TRAINING_STAT_TILES) {
      expect(text(layout.testId, 'label')).toBe(ORG_TRAINING_STAT_DEFINITIONS[layout.key].label);
    }
  });

  it('shows the numbers of the payload, localized, with the rate as a percentage', () => {
    render(STATS, '730d');

    expect(text('org-training-stat-roster-members', 'value')).toBe('17,000');
    expect(text('org-training-stat-people-with-training-activity', 'value')).toBe('4,199');
    expect(text('org-training-stat-courses-taken', 'value')).toBe('9,660');
    expect(text('org-training-stat-certifications', 'value')).toBe('1,134');
    expect(text('org-training-stat-certified-people', 'value')).toBe('857');
    expect(text('org-training-stat-trainings-completed', 'value')).toBe('2,373');
    expect(text('org-training-stat-completion-rate', 'value')).toBe('36%');
    expect(text('org-training-stat-courses-in-progress', 'value')).toBe('6,153');
    expect(text('org-training-stat-people-in-training', 'value')).toBe('3,093');
  });

  it('states the selected range and the in-progress rule, and the roster as live', () => {
    render(STATS, '730d');

    expect(text('org-training-stat-courses-taken', 'caption')).toContain('Past 2 years');
    expect(text('org-training-stat-courses-taken', 'caption')).toContain('Oct 30, 2026');
    expect(text('org-training-stat-courses-in-progress', 'caption')).toContain('no certificate in the range');
    expect(text('org-training-stat-roster-members', 'caption')).toContain('live, not filtered');
    expect(text('org-training-stat-roster-members', 'caption')).toContain('Nov 1, 2026');

    render(STATS, 'all');
    expect(text('org-training-stat-courses-taken', 'caption')).toContain('all time');
    expect(text('org-training-stat-courses-taken', 'caption')).not.toContain('Past 2 years');
  });

  it('names each tile by its value before the definition and carries the tooltip text', () => {
    render(STATS, '730d');

    for (const layout of ORG_TRAINING_STAT_TILES) {
      const node = tile(layout.testId);
      expect(node.getAttribute('role')).toBe('note');
      expect(node.getAttribute('aria-label')).toContain(`: ${text(layout.testId, 'value')}. `);
      expect(node.getAttribute('aria-label')).toContain(ORG_TRAINING_STAT_DEFINITIONS[layout.key].definition);
    }
  });

  it('shows dashes and the definitions, no as-of date, while the stats are not loaded', () => {
    render(null, '730d');

    for (const layout of ORG_TRAINING_STAT_TILES) {
      expect(text(layout.testId, 'value')).toBe('—');
      expect(text(layout.testId, 'caption')).not.toContain('as of');
      expect(tile(layout.testId).getAttribute('aria-label')).toContain(ORG_TRAINING_STAT_DEFINITIONS[layout.key].definition);
    }
  });

  it('says an organization without a training program has no roster, instead of a zero', () => {
    render({ ...STATS, rosterMembers: null, rosterMembersAsOf: null }, '730d');

    expect(text('org-training-stat-roster-members', 'value')).toBe('—');
    expect(text('org-training-stat-roster-members', 'caption')).toBe(ORG_TRAINING_NO_ROSTER_NOTE);
  });

  describe('collapsible strip', () => {
    const primaryIds = ORG_TRAINING_STAT_TILES.filter((layout) => ORG_TRAINING_STAT_PRIMARY_KEYS.includes(layout.key)).map((layout) => layout.testId);
    const otherIds = ORG_TRAINING_STAT_TILES.filter((layout) => !ORG_TRAINING_STAT_PRIMARY_KEYS.includes(layout.key)).map((layout) => layout.testId);
    const shown = (): string[] => ORG_TRAINING_STAT_TILES.map((layout) => layout.testId).filter((testId) => !tile(testId).classList.contains('hidden'));
    const toggle = (): HTMLButtonElement | null => el().querySelector<HTMLButtonElement>('[data-testid="org-training-stats-toggle"]');

    function renderCollapsible(stats: OrgTrainingStats | null = STATS): void {
      fixture.componentRef.setInput('collapsible', true);
      render(stats, '730d');
    }

    it('shows every tile and no link when the strip is not collapsible', () => {
      render(STATS, '730d');

      expect(shown()).toEqual(ORG_TRAINING_STAT_TILES.map((layout) => layout.testId));
      expect(toggle()).toBeNull();
    });

    it('starts with the people-list tiles only and offers the others', () => {
      renderCollapsible();

      expect(shown()).toEqual(primaryIds);
      expect(primaryIds).toEqual(['org-training-stat-people-with-training-activity', 'org-training-stat-courses-taken', 'org-training-stat-certified-people']);
      expect(toggle()?.textContent?.trim()).toBe(`Show ${otherIds.length} more stats`);
      expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    });

    it('reveals every tile on the link and hides the others again on the second press', () => {
      renderCollapsible();

      toggle()!.click();
      fixture.detectChanges();
      expect(shown()).toEqual(ORG_TRAINING_STAT_TILES.map((layout) => layout.testId));
      expect(toggle()?.textContent?.trim()).toBe('Show fewer stats');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

      toggle()!.click();
      fixture.detectChanges();
      expect(shown()).toEqual(primaryIds);
    });

    it('keeps the values of the hidden tiles identical to the open strip', () => {
      renderCollapsible();
      const collapsedValues = otherIds.map((testId) => text(testId, 'value'));

      toggle()!.click();
      fixture.detectChanges();

      expect(otherIds.map((testId) => text(testId, 'value'))).toEqual(collapsedValues);
      expect(text('org-training-stat-roster-members', 'value')).toBe('17,000');
    });
  });
});
