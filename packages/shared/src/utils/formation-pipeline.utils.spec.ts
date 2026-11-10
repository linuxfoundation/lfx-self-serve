// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { FormationPipelineRow } from '../interfaces/formation-pipeline.interface';
import {
  buildPipelineCsv,
  chunkArray,
  buildPipelinePillOptions,
  buildPipelineStatCards,
  countPipelineRows,
  filterPipelineRowsByStage,
  getPipelineCsvFilename,
  getPipelineEdPmLines,
  getPipelineLaunch,
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
    expect(getPipelineLaunch(null, NOW)).toEqual({ dateLabel: 'Not set', relativeLabel: '', soon: false });
  });

  it('shows days within two weeks and flags the next 30 days', () => {
    expect(getPipelineLaunch('2026-11-18T00:00:00Z', NOW)).toEqual({ dateLabel: 'Nov 18, 2026', relativeLabel: 'In 8 days', soon: true });
  });

  it('shows weeks beyond two weeks and is not soon past 30 days', () => {
    expect(getPipelineLaunch('2027-01-12T00:00:00Z', NOW)).toMatchObject({ relativeLabel: 'In 9 weeks', soon: false });
  });

  it('gives no relative hint for a past date', () => {
    expect(getPipelineLaunch('2026-10-01T00:00:00Z', NOW)).toMatchObject({ relativeLabel: '', soon: false });
  });
});

describe('sortPipelineRows', () => {
  const rows = [
    row({ uid: 'a', name: 'Bravo', announcement_date: '2027-01-12T00:00:00Z' }),
    row({ uid: 'b', name: 'Alpha', announcement_date: null }),
    row({ uid: 'c', name: 'Charlie', announcement_date: '2026-11-18T00:00:00Z' }),
  ];

  it('sorts launch ascending with Not set last', () => {
    expect(sortPipelineRows(rows, { key: 'expected_launch', direction: 'asc' }).map((r) => r.uid)).toEqual(['c', 'a', 'b']);
  });

  it('keeps Not set last when descending', () => {
    expect(sortPipelineRows(rows, { key: 'expected_launch', direction: 'desc' }).map((r) => r.uid)).toEqual(['a', 'c', 'b']);
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
    expect(ids).toEqual(['all', 'prospect', 'exploratory', 'engaged', 'on_hold', 'archived']);
  });

  it('shows Disengaged when it has rows and labels Prospect as Draft', () => {
    const pills = buildPipelinePillOptions({ ...counts, disengaged: 2 });
    expect(pills.map((pill) => pill.id)).toContain('disengaged');
    expect(pills.find((pill) => pill.id === 'prospect')?.label).toBe('Draft (0)');
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

describe('buildPipelineCsv', () => {
  it('emits the visible columns and neutralizes formula cells', () => {
    const csv = buildPipelineCsv([
      row({ name: '=HYPERLINK("x")', stage: 'prospect', announcement_date: '2026-11-18T00:00:00Z', executive_director: { name: 'Ed, Jr', email: 'e@x.org' } }),
    ]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe('Project,Foundation,Stage,Expected launch,Formation date,Legal entity,ED,PM,Opportunity owner,Updated');
    expect(line).toBe('"\'=HYPERLINK(""x"")",Foundation,Draft,2026-11-18,,,"Ed, Jr",,,');
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
