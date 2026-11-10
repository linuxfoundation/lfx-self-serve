// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { rowsToCsv } from './file.utils';
import type { FormationPipelineRow } from '../interfaces/formation-pipeline.interface';
import {
  buildPipelineCsvRows,
  chunkArray,
  buildPipelinePillOptions,
  buildPipelineStatCards,
  countPipelineRows,
  filterPipelineRowsByStage,
  getPipelineCsvFilename,
  getPipelineEdPmLines,
  getPipelineLaunch,
  getPipelineRowLink,
  toPipelineTableRow,
  getPipelineStageKey,
  matchesPipelineSearch,
  sortPipelineRows,
} from './formation-pipeline.utils';

const NOW = new Date('2026-11-10T12:00:00Z');

function row(overrides: Partial<FormationPipelineRow> = {}): FormationPipelineRow {
  return {
    uid: 'u1',
    slug: 's1',
    name: 'Alpha',
    stage: 'exploratory',
    parent: { uid: 'p1', name: 'Foundation' },
    announcement_date: null,
    formation_date: null,
    legal_entity_name: null,
    legal_entity_type: null,
    executive_director: null,
    program_manager: null,
    opportunity_owner: null,
    created_at: null,
    updated_at: null,
    has_checklist: false,
    ...overrides,
  };
}

describe('getPipelineStageKey', () => {
  it('maps upstream stages and rejects Active and unknown values', () => {
    expect(getPipelineStageKey('Prospect')).toBe('prospect');
    expect(getPipelineStageKey('Formation - On Hold')).toBe('on_hold');
    expect(getPipelineStageKey('Archived')).toBe('archived');
    expect(getPipelineStageKey('Active')).toBeNull();
    expect(getPipelineStageKey(undefined)).toBeNull();
  });
});

describe('counts, filter, search', () => {
  const rows = [row({ uid: 'a', stage: 'prospect' }), row({ uid: 'b', stage: 'engaged' }), row({ uid: 'c', stage: 'engaged' })];

  it('counts per stage and total', () => {
    expect(countPipelineRows(rows)).toMatchObject({ prospect: 1, engaged: 2, archived: 0, total: 3 });
  });

  it('filters to the live stages for in_pipeline', () => {
    const mixed = [
      row({ uid: 'a', stage: 'prospect' }),
      row({ uid: 'b', stage: 'disengaged' }),
      row({ uid: 'c', stage: 'archived' }),
      row({ uid: 'd', stage: 'on_hold' }),
    ];
    expect(filterPipelineRowsByStage(mixed, 'in_pipeline').map((r) => r.uid)).toEqual(['a', 'd']);
  });

  it('filters by stage and keeps all for "all"', () => {
    expect(filterPipelineRowsByStage(rows, 'engaged')).toHaveLength(2);
    expect(filterPipelineRowsByStage(rows, 'all')).toHaveLength(3);
  });

  it('matches names case-insensitively and treats blank as match-all', () => {
    expect(matchesPipelineSearch('Open Fleet', 'fleet')).toBe(true);
    expect(matchesPipelineSearch('Open Fleet', 'xyz')).toBe(false);
    expect(matchesPipelineSearch('Open Fleet', '  ')).toBe(true);
  });
});

describe('getPipelineLaunch', () => {
  it('reads Not set for an empty date', () => {
    expect(getPipelineLaunch(null, NOW)).toEqual({ dateLabel: 'Not set', relativeLabel: '', soon: false, overdue: false });
  });

  it('shows days within two weeks and flags the next 30 days', () => {
    expect(getPipelineLaunch('2026-11-18T00:00:00Z', NOW)).toEqual({ dateLabel: 'Nov 18, 2026', relativeLabel: 'In 8 days', soon: true, overdue: false });
  });

  it('shows weeks beyond two weeks and is not soon past 30 days', () => {
    expect(getPipelineLaunch('2027-01-12T00:00:00Z', NOW)).toMatchObject({ relativeLabel: 'In 9 weeks', soon: false });
  });

  it('marks a past date Overdue, but not for an archived project', () => {
    expect(getPipelineLaunch('2026-10-01T00:00:00Z', NOW)).toMatchObject({ dateLabel: 'Oct 1, 2026', relativeLabel: 'Overdue', soon: false, overdue: true });
    expect(getPipelineLaunch('2026-10-01T00:00:00Z', NOW, false)).toMatchObject({ relativeLabel: '', overdue: false });
  });

  it('does not call today overdue', () => {
    expect(getPipelineLaunch('2026-11-10T00:00:00Z', NOW)).toMatchObject({ relativeLabel: 'Today', overdue: false });
  });
});

describe('sortPipelineRows', () => {
  const rows = [
    row({ uid: 'a', name: 'Bravo', announcement_date: '2027-01-12T00:00:00Z' }),
    row({ uid: 'b', name: 'Alpha', announcement_date: null }),
    row({ uid: 'c', name: 'Charlie', announcement_date: '2026-11-18T00:00:00Z' }),
  ];

  it('sorts launch ascending: upcoming soonest first, then past (most recent first), then Not set', () => {
    const withPast = [
      ...rows,
      row({ uid: 'p1', name: 'Past old', announcement_date: '2026-01-01T00:00:00Z' }),
      row({ uid: 'p2', name: 'Past recent', announcement_date: '2026-11-01T00:00:00Z' }),
    ];
    expect(sortPipelineRows(withPast, { key: 'expected_launch', direction: 'asc' }, NOW).map((r) => r.uid)).toEqual(['c', 'a', 'p2', 'p1', 'b']);
  });

  it('keeps upcoming, past and Not set in that order when descending', () => {
    const withPast = [
      ...rows,
      row({ uid: 'p1', name: 'Past old', announcement_date: '2026-01-01T00:00:00Z' }),
      row({ uid: 'p2', name: 'Past recent', announcement_date: '2026-11-01T00:00:00Z' }),
    ];
    expect(sortPipelineRows(withPast, { key: 'expected_launch', direction: 'desc' }, NOW).map((r) => r.uid)).toEqual(['a', 'c', 'p1', 'p2', 'b']);
  });

  it('sorts by every column without throwing', () => {
    for (const key of ['project', 'stage', 'expected_launch', 'formation_date', 'legal_entity', 'ed_pm', 'opportunity_owner', 'updated'] as const) {
      expect(sortPipelineRows(rows, { key, direction: 'asc' })).toHaveLength(3);
    }
  });

  it('sorts by project name', () => {
    expect(sortPipelineRows(rows, { key: 'project', direction: 'asc' }).map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});

describe('pills, stat cards, people', () => {
  const rows = [
    row({ uid: 'a', stage: 'engaged', announcement_date: '2026-11-18T00:00:00Z' }),
    row({ uid: 'b', stage: 'exploratory', announcement_date: '2027-03-01T00:00:00Z' }),
  ];
  const counts = countPipelineRows(rows);

  it('hides Disengaged and Confidential pills at zero', () => {
    const ids = buildPipelinePillOptions(counts).map((pill) => pill.id);
    expect(ids).toEqual(['in_pipeline', 'all', 'prospect', 'exploratory', 'engaged', 'on_hold', 'archived']);
  });

  it('shows Disengaged when it has rows and labels Prospect as Draft', () => {
    const pills = buildPipelinePillOptions({ ...counts, disengaged: 2 });
    expect(pills.map((pill) => pill.id)).toContain('disengaged');
    expect(pills.find((pill) => pill.id === 'prospect')?.label).toBe('Draft (0)');
  });

  it('puts In pipeline first, counting only the live stages', () => {
    const pills = buildPipelinePillOptions({
      ...countPipelineRows([]),
      prospect: 2,
      exploratory: 3,
      engaged: 1,
      on_hold: 1,
      disengaged: 9,
      archived: 5,
      total: 21,
    });
    expect(pills.slice(0, 2).map((pill) => pill.label)).toEqual(['In pipeline (7)', 'All (21)']);
  });

  it('builds five stat cards and marks the selected one', () => {
    const cards = buildPipelineStatCards(counts, rows, 'engaged', NOW);
    expect(cards.map((card) => card.action)).toEqual(['prospect', 'exploratory', 'engaged', 'on_hold', 'archived']);
    expect(cards.find((card) => card.action === 'engaged')).toMatchObject({ value: 1, selected: true, subLine: '1 launching in the next 30 days' });
    expect(cards.find((card) => card.action === 'exploratory')?.subLine).toBe('1 with an expected launch date');
  });

  it('falls back to design copy for unassigned ED and PM', () => {
    expect(getPipelineEdPmLines(row())).toEqual({ ed: 'Not assigned', pm: 'No PM yet' });
  });
});

describe('buildPipelineCsvRows', () => {
  it('emits the visible columns in order, and rowsToCsv neutralizes formula cells', () => {
    const matrix = buildPipelineCsvRows([
      row({ name: '=HYPERLINK("x")', stage: 'prospect', announcement_date: '2026-11-18T00:00:00Z', executive_director: { name: 'Ed, Jr', email: 'e@x.org' } }),
    ]);
    expect(matrix[0]).toEqual([
      'Project',
      'Foundation',
      'Stage',
      'Expected launch',
      'Formation date',
      'Legal entity',
      'ED',
      'PM',
      'Opportunity owner',
      'Updated',
    ]);
    expect(rowsToCsv(matrix).split('\r\n')[1]).toBe('"\'=HYPERLINK(""x"")",Foundation,Draft,2026-11-18,,,"Ed, Jr",,,');
  });

  it('names the file by day', () => {
    expect(getPipelineCsvFilename(NOW)).toBe('formation-pipeline-2026-11-10.csv');
  });
});

describe('chunkArray', () => {
  it('splits into batches of at most size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
  });
});

describe('row link and table row', () => {
  it('links to the checklist only when one exists, otherwise to the project dashboard', () => {
    expect(getPipelineRowLink({ slug: 'a', has_checklist: true })).toEqual({ commands: ['/foundation/formations', 'a'], queryParams: null });
    expect(getPipelineRowLink({ slug: 'a', has_checklist: false })).toEqual({ commands: ['/project/overview'], queryParams: { project: 'a' } });
  });

  it('resolves display strings', () => {
    const view = toPipelineTableRow(
      row({ stage: 'prospect', announcement_date: '2026-11-18T00:00:00Z', formation_date: '2026-01-05T00:00:00Z', legal_entity_name: ' Acme LLC ' }),
      NOW
    );
    expect(view).toMatchObject({
      stageLabel: 'Draft',
      stageSeverity: 'secondary',
      formationDateLabel: 'Jan 5, 2026',
      legalEntityLabel: 'Acme LLC',
      edLine: 'Not assigned',
      pmLine: 'No PM yet',
    });
    expect(view.launch.relativeLabel).toBe('In 8 days');
  });
});
