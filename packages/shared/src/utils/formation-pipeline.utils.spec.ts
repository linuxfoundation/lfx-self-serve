// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import { rowsToCsv } from './file.utils';
import type { FormationPipelineRow } from '../interfaces/formation-pipeline.interface';
import {
  FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUE_LENGTH,
  FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUES,
  FORMATION_PIPELINE_SEARCH_MAX_LENGTH,
} from '../constants/formation-pipeline.constants';
import {
  buildPipelineCsvRows,
  buildPipelineUrlParams,
  emptyPipelineClassification,
  filterPipelineRowsByClassification,
  getPipelineClassificationOptions,
  hasPipelineClassificationFilter,
  normalizePipelineClassification,
  pruneUnknownPipelineClassification,
  sanitizePipelineClassificationValues,
  clearedPipelineUrlParams,
  getDefaultPipelineUrlState,
  parsePipelineUrlState,
  chunkArray,
  buildPipelinePillOptions,
  buildPipelineStatCards,
  comparePipelineText,
  countPipelineRows,
  filterPipelineRowsByFoundationKind,
  filterPipelineRowsByStage,
  getPipelineCsvFilename,
  getFormationStageDisplayLabel,
  getPipelineEdPmLines,
  getPipelineFormationLead,
  getPipelineLaunch,
  getPipelineRowLink,
  toPipelineTableRow,
  getPipelineStageKey,
  matchesPipelineSearch,
  normalizePipelineSearch,
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
    formation_lead: null,
    technical_activity_type: [],
    technology: [],
    industry: [],
    foundation_kind: 'under_foundation',
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
    for (const key of [
      'project',
      'stage',
      'expected_launch',
      'formation_date',
      'legal_entity',
      'ed_pm',
      'formation_lead',
      'opportunity_owner',
      'updated',
    ] as const) {
      expect(sortPipelineRows(rows, { key, direction: 'asc' })).toHaveLength(3);
    }
  });

  it('sorts by formation lead, with unset leads last in either direction', () => {
    const led = [
      row({ uid: 'x', name: 'X', formation_lead: { name: 'Zed Lead', email: 'z@example.com' } }),
      row({ uid: 'y', name: 'Y', formation_lead: null }),
      row({ uid: 'w', name: 'W', formation_lead: { name: '', email: 'a@example.com' } }),
      row({ uid: 'v', name: 'V', formation_lead: { name: 'Amy Lead', email: 'amy@example.com' } }),
    ];
    expect(sortPipelineRows(led, { key: 'formation_lead', direction: 'asc' }).map((r) => r.uid)).toEqual(['w', 'v', 'x', 'y']);
    expect(sortPipelineRows(led, { key: 'formation_lead', direction: 'desc' }).map((r) => r.uid)).toEqual(['x', 'v', 'w', 'y']);
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
      row({
        name: '=HYPERLINK("x")',
        stage: 'prospect',
        announcement_date: '2026-11-18T00:00:00Z',
        executive_director: { name: 'Ed, Jr', email: 'e@example.com' },
        formation_lead: { name: 'Lee Lead', email: 'lee@example.com' },
      }),
    ]);
    expect(matrix[0]).toEqual([
      'Project',
      'Foundation',
      'Stage',
      'Expected launch',
      'Formation lead',
      'Formation date',
      'Legal entity',
      'ED',
      'PM',
      'Opportunity owner',
      'Updated',
      'Technical activity type',
      'Technology',
      'Industry',
    ]);
    expect(rowsToCsv(matrix).split('\r\n')[1]).toBe('"\'=HYPERLINK(""x"")",Foundation,Draft,2026-11-18,Lee Lead,,,"Ed, Jr",,,,,,');
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
  it('links to the formation page for every stage but Archived, with or without a checklist', () => {
    const formation = { commands: ['/foundation/formations', 'a'], queryParams: null };
    const dashboard = { commands: ['/project/overview'], queryParams: { project: 'a' } };
    expect(getPipelineRowLink({ slug: 'a', stage: 'engaged' })).toEqual(formation);
    expect(getPipelineRowLink({ slug: 'a', stage: 'disengaged' })).toEqual(formation);
    expect(getPipelineRowLink({ slug: 'a', stage: 'prospect' })).toEqual(formation);
    expect(getPipelineRowLink({ slug: 'a', stage: 'exploratory' })).toEqual(formation);
    expect(getPipelineRowLink({ slug: 'a', stage: 'archived' })).toEqual(dashboard);
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

describe('comparePipelineText', () => {
  it('orders case- and accent-insensitively in the en locale, whatever the runtime default', () => {
    expect(['b', 'A', 'a', 'é', 'e', 'Z'].sort(comparePipelineText)).toEqual(['A', 'a', 'b', 'é', 'e', 'Z'].sort(comparePipelineText));
    expect(comparePipelineText('alpha', 'Alpha')).toBe(0);
    expect(comparePipelineText('e', 'é')).toBe(0);
    expect(comparePipelineText('a', 'b')).toBeLessThan(0);
  });

  it('pins the en locale', () => {
    const spy = vi.spyOn(String.prototype, 'localeCompare');
    comparePipelineText('a', 'b');
    expect(spy).toHaveBeenCalledWith('b', 'en', { sensitivity: 'base' });
    spy.mockRestore();
  });
});

describe('getFormationStageDisplayLabel (#5619)', () => {
  it('shows a stored Prospect as Draft and leaves every other stage as stored', () => {
    expect(getFormationStageDisplayLabel('Prospect')).toBe('Draft');
    expect(getFormationStageDisplayLabel('Formation - Engaged')).toBe('Formation - Engaged');
    expect(getFormationStageDisplayLabel('')).toBe('');
  });

  it('puts the neutral caption on the Archived stat card', () => {
    const cards = buildPipelineStatCards(countPipelineRows([row({ stage: 'archived' })]), [], 'in_pipeline', NOW);
    expect(cards.find((card) => card.action === 'archived')?.subLine).toBe('No longer active');
  });
});

describe('getPipelineFormationLead (#5619)', () => {
  it('serves the name with the email for the tooltip, and "Not set" when empty or missing', () => {
    expect(getPipelineFormationLead(row({ formation_lead: { name: 'Lee Lead', email: 'lee@example.com' } }))).toEqual({
      name: 'Lee Lead',
      email: 'lee@example.com',
    });
    expect(getPipelineFormationLead(row({ formation_lead: { name: '', email: 'lee@example.com' } }))).toEqual({
      name: 'lee@example.com',
      email: 'lee@example.com',
    });
    expect(getPipelineFormationLead(row({ formation_lead: { name: '', email: '' } }))).toEqual({ name: 'Not set', email: '' });
    expect(getPipelineFormationLead(row({ formation_lead: null }))).toEqual({ name: 'Not set', email: '' });
  });

  it('flows into the table row for the table and the phone card', () => {
    const tableRow = toPipelineTableRow(row({ formation_lead: { name: 'Lee Lead', email: 'lee@example.com' } }), NOW);
    expect(tableRow.formationLeadLabel).toBe('Lee Lead');
    expect(tableRow.formationLeadEmail).toBe('lee@example.com');
    expect(toPipelineTableRow(row(), NOW)).toMatchObject({ formationLeadLabel: 'Not set', formationLeadEmail: '' });
  });
});

describe('filterPipelineRowsByFoundationKind (#5619)', () => {
  const rows = [
    row({ uid: 'n', foundation_kind: 'under_lf', parent: { uid: 'lf', name: 'The Linux Foundation' } }),
    row({ uid: 'u', foundation_kind: 'under_foundation' }),
    row({ uid: 'x', foundation_kind: 'no_parent', parent: null }),
  ];

  it('keeps every row for "all" and exactly one kind otherwise', () => {
    expect(filterPipelineRowsByFoundationKind(rows, 'all').map((r) => r.uid)).toEqual(['n', 'u', 'x']);
    expect(filterPipelineRowsByFoundationKind(rows, 'under_lf').map((r) => r.uid)).toEqual(['n']);
    expect(filterPipelineRowsByFoundationKind(rows, 'under_foundation').map((r) => r.uid)).toEqual(['u']);
    expect(filterPipelineRowsByFoundationKind(rows, 'no_parent').map((r) => r.uid)).toEqual(['x']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    filterPipelineRowsByFoundationKind(rows, 'under_lf');
    expect(rows).toEqual(copy);
  });
});

describe('Pipeline URL state (#5619)', () => {
  const fromQuery = (query: string) => parsePipelineUrlState(new URLSearchParams(query));
  const toQuery = (state: ReturnType<typeof getDefaultPipelineUrlState>): string => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(buildPipelineUrlParams(state))) {
      if (value === null) continue;
      for (const entry of [value].flat()) params.append(name, entry);
    }
    return params.toString();
  };

  it('applies one search length everywhere: a search past the maximum is cut the same way when written, read and matched', () => {
    const long = 'a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH + 40);
    const cut = 'a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH);
    expect(normalizePipelineSearch(`  ${long}  `)).toBe(cut);
    expect(buildPipelineUrlParams({ ...getDefaultPipelineUrlState(), search: long })['q']).toBe(cut);
    // The link the page writes reopens with exactly the search that filtered the rows.
    const reopened = fromQuery(toQuery({ ...getDefaultPipelineUrlState(), search: long }));
    expect(reopened.search).toBe(cut);
    expect(fromQuery(`q=${long}`).search).toBe(cut);
    // The live filter agrees: the long and the cut search match the same names.
    expect(matchesPipelineSearch(`${cut}b`, long)).toBe(matchesPipelineSearch(`${cut}b`, cut));
    expect(matchesPipelineSearch(`${cut}b`, long)).toBe(true);
  });

  it('never cuts a search inside a surrogate pair, so the written link always encodes and reads back the same', () => {
    const emoji = '🚀';
    const atLimit = 'a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH - 1) + emoji;
    const cut = normalizePipelineSearch(atLimit);
    expect(cut).toBe('a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH - 1));
    expect(() => encodeURIComponent(cut)).not.toThrow();
    const state = { ...getDefaultPipelineUrlState(), search: atLimit };
    expect(fromQuery(toQuery(state)).search).toBe(cut);
    expect(matchesPipelineSearch(`${cut}b`, atLimit)).toBe(true);
    // A pair that fits whole is kept.
    expect(normalizePipelineSearch('a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH - 2) + emoji)).toBe(
      'a'.repeat(FORMATION_PIPELINE_SEARCH_MAX_LENGTH - 2) + emoji
    );
  });

  it('opens on the defaults for an empty query, and writes nothing for the defaults', () => {
    expect(fromQuery('')).toEqual(getDefaultPipelineUrlState());
    expect(toQuery(getDefaultPipelineUrlState())).toBe('');
  });

  it('round-trips every field through the URL', () => {
    const state = {
      stage: 'archived' as const,
      foundationUid: 'f-uid_1',
      foundationKind: 'under_foundation' as const,
      search: 'quantum & more',
      classification: emptyPipelineClassification(),
      sort: { key: 'formation_lead' as const, direction: 'desc' as const },
    };
    const query = toQuery(state);

    expect(query).toBe('stage=archived&foundation=f-uid_1&type=under_foundation&q=quantum+%26+more&sort=formation_lead&dir=desc');
    expect(fromQuery(query)).toEqual(state);
  });

  it('round-trips each stage selection and each foundation kind', () => {
    for (const stage of ['all', 'in_pipeline', 'prospect', 'exploratory', 'engaged', 'on_hold', 'disengaged', 'confidential', 'archived'] as const) {
      expect(fromQuery(toQuery({ ...getDefaultPipelineUrlState(), stage })).stage).toBe(stage);
    }
    for (const foundationKind of ['all', 'under_lf', 'under_foundation', 'no_parent'] as const) {
      expect(fromQuery(toQuery({ ...getDefaultPipelineUrlState(), foundationKind })).foundationKind).toBe(foundationKind);
    }
  });

  it('omits the sort pair only when it is the default sort', () => {
    const defaults = getDefaultPipelineUrlState();
    expect(buildPipelineUrlParams({ ...defaults, sort: { key: defaults.sort.key, direction: 'desc' } })).toMatchObject({
      sort: defaults.sort.key,
      dir: 'desc',
    });
    expect(buildPipelineUrlParams(defaults)).toMatchObject({ sort: null, dir: null });
  });

  it('falls back to the default for one bad value without discarding the others', () => {
    const state = fromQuery('stage=bogus&type=nope&sort=nope&foundation=has%20space&q=%20alpha%20&dir=desc');

    expect(state).toEqual({ ...getDefaultPipelineUrlState(), search: 'alpha' });
    expect(fromQuery('stage=engaged&type=bogus').stage).toBe('engaged');
    expect(fromQuery('sort=ed_pm&dir=sideways').sort).toEqual({ key: 'ed_pm', direction: 'asc' });
  });

  it('maps the foundation types of an earlier link to the default rather than guessing', () => {
    expect(fromQuery('type=new_foundation').foundationKind).toBe('all');
    expect(fromQuery('type=no_foundation').foundationKind).toBe('all');
    expect(fromQuery('type=under_lf').foundationKind).toBe('under_lf');
    expect(fromQuery('type=under_foundation').foundationKind).toBe('under_foundation');
    expect(fromQuery('type=no_parent').foundationKind).toBe('no_parent');
  });

  it('cuts an over-long search to the API limit', () => {
    expect(fromQuery(`q=${'a'.repeat(300)}`).search).toHaveLength(100);
  });

  it('clears every Pipeline param when leaving the tab', () => {
    expect(clearedPipelineUrlParams()).toEqual({ stage: null, foundation: null, type: null, q: null, sort: null, dir: null, tat: null, tech: null, ind: null });
  });
});

describe('Pipeline classification filters (#5619 Part C)', () => {
  const OSS = 'Open Source Software';
  const SPEC = 'Open Standard / Specification';
  const rows = [
    row({ uid: 'a', stage: 'engaged', technical_activity_type: [OSS, SPEC], technology: ['Quantum'], industry: ['Finance'] }),
    row({ uid: 'b', stage: 'engaged', technical_activity_type: [SPEC], technology: ['AI / ML'], industry: [] }),
    row({ uid: 'c', stage: 'exploratory', technical_activity_type: [OSS], technology: ['Quantum', 'AI / ML'], industry: ['Finance', 'Health'] }),
    row({ uid: 'd', stage: 'exploratory', technical_activity_type: [], technology: [], industry: [] }),
  ];
  const select = (selection: Partial<ReturnType<typeof emptyPipelineClassification>>) => ({ ...emptyPipelineClassification(), ...selection });
  const uids = (list: FormationPipelineRow[]) => list.map((r) => r.uid);

  it('maps present, empty and missing arrays', () => {
    expect(normalizePipelineClassification([OSS, SPEC])).toEqual([OSS, SPEC]);
    expect(normalizePipelineClassification([])).toEqual([]);
    expect(normalizePipelineClassification(undefined)).toEqual([]);
    expect(normalizePipelineClassification(null)).toEqual([]);
    expect(normalizePipelineClassification('Open Source Software')).toEqual([]);
    expect(normalizePipelineClassification([' A ', 'A', '', 3, null, 'B'])).toEqual(['A', 'B']);
  });

  it('shows every row, including empty-array rows, when no classification filter is set', () => {
    expect(hasPipelineClassificationFilter(emptyPipelineClassification())).toBe(false);
    expect(uids(filterPipelineRowsByClassification(rows, emptyPipelineClassification()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by each field alone; a row matches when any of its values is selected', () => {
    expect(uids(filterPipelineRowsByClassification(rows, select({ technical_activity_type: [SPEC] })))).toEqual(['a', 'b']);
    expect(uids(filterPipelineRowsByClassification(rows, select({ technology: ['Quantum'] })))).toEqual(['a', 'c']);
    expect(uids(filterPipelineRowsByClassification(rows, select({ industry: ['Health'] })))).toEqual(['c']);
  });

  it('is OR within a filter and AND across filters', () => {
    expect(uids(filterPipelineRowsByClassification(rows, select({ technical_activity_type: [OSS, SPEC] })))).toEqual(['a', 'b', 'c']);
    expect(uids(filterPipelineRowsByClassification(rows, select({ technical_activity_type: [SPEC], technology: ['Quantum'] })))).toEqual(['a']);
    expect(uids(filterPipelineRowsByClassification(rows, select({ technical_activity_type: [SPEC], industry: ['Health'] })))).toEqual([]);
  });

  it('hides an empty-array row under any active filter, whichever field the filter is on', () => {
    expect(uids(filterPipelineRowsByClassification(rows, select({ industry: ['Finance'] })))).toEqual(['a', 'c']);
    expect(uids(filterPipelineRowsByClassification(rows, select({ technology: ['Quantum', 'AI / ML'] })))).toEqual(['a', 'b', 'c']);
  });

  it('lists the values present, sorted, with counts that follow the other filters', () => {
    expect(getPipelineClassificationOptions(rows, 'technical_activity_type')).toEqual([
      { value: OSS, count: 2 },
      { value: SPEC, count: 2 },
    ]);
    // Technology options, seen after the Industry filter (the field's own filter is left out).
    const afterIndustry = filterPipelineRowsByClassification(rows, select({ industry: ['Health'], technology: ['Quantum'] }), 'technology');
    expect(getPipelineClassificationOptions(afterIndustry, 'technology')).toEqual([
      { value: 'AI / ML', count: 1 },
      { value: 'Quantum', count: 1 },
    ]);
    expect(getPipelineClassificationOptions([], 'industry')).toEqual([]);
  });

  it('neutralizes a formula prefix on every value of a classification cell, not only the first', () => {
    const risky = row({ technology: ['=SUM(1)', 'Safe', '@cmd', '-1+1'] });
    const csv = rowsToCsv(buildPipelineCsvRows([risky])).split('\r\n')[1];
    expect(csv).toContain("'=SUM(1); Safe; '@cmd; '-1+1");
    expect(csv).not.toMatch(/; [=+\-@]/);
  });

  it('adds three CSV columns after the existing ones, joined with "; "', () => {
    const [header, first, empty] = buildPipelineCsvRows([rows[0], rows[3]]);
    expect(header.slice(-3)).toEqual(['Technical activity type', 'Technology', 'Industry']);
    expect(first.slice(-3)).toEqual([`${OSS}; ${SPEC}`, 'Quantum', 'Finance']);
    expect(empty.slice(-3)).toEqual(['', '', '']);
    expect(header).toHaveLength(first.length);
  });

  describe('URL state', () => {
    const fromQuery = (query: string) => parsePipelineUrlState(new URLSearchParams(query));
    const toQuery = (state: ReturnType<typeof getDefaultPipelineUrlState>): string => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(buildPipelineUrlParams(state))) {
        if (value === null) continue;
        for (const entry of [value].flat()) params.append(name, entry);
      }
      return params.toString();
    };

    it('writes nothing for the defaults and repeats a param per value', () => {
      expect(toQuery(getDefaultPipelineUrlState())).toBe('');
      const state = { ...getDefaultPipelineUrlState(), classification: select({ technical_activity_type: [OSS, SPEC], industry: ['Finance'] }) };
      expect(toQuery(state)).toBe('tat=Open+Source+Software&tat=Open+Standard+%2F+Specification&ind=Finance');
    });

    it('round-trips values with spaces, "/" and "&"', () => {
      const classification = select({ technical_activity_type: [SPEC], technology: ['R&D / Labs', 'AI, ML'], industry: ['A=B'] });
      const state = { ...getDefaultPipelineUrlState(), classification };
      expect(fromQuery(toQuery(state)).classification).toEqual(classification);
    });

    it('drops empty, over-long and repeated values, and caps how many a link may carry', () => {
      const long = 'x'.repeat(FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUE_LENGTH + 1);
      expect(sanitizePipelineClassificationValues(['', '  ', long, 'ok', ' ok '])).toEqual(['ok']);
      const many = Array.from({ length: FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUES + 10 }, (_, index) => `v${index}`);
      expect(sanitizePipelineClassificationValues(many)).toHaveLength(FORMATION_PIPELINE_CLASSIFICATION_MAX_VALUES);
      expect(fromQuery(`tat=&tat=${long}&tech=Quantum`).classification).toEqual(select({ technology: ['Quantum'] }));
    });

    it('treats prototype-looking values as plain text', () => {
      const parsed = fromQuery('tat=__proto__&tech=constructor&ind=toString');
      expect(parsed.classification).toEqual(select({ technical_activity_type: ['__proto__'], technology: ['constructor'], industry: ['toString'] }));
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(filterPipelineRowsByClassification(rows, parsed.classification)).toEqual([]);
      expect(pruneUnknownPipelineClassification(parsed.classification, rows)).toEqual(emptyPipelineClassification());
    });

    it('drops a value no row holds once the rows are known', () => {
      const pruned = pruneUnknownPipelineClassification(select({ technical_activity_type: [SPEC, 'Not A Real Type'], industry: ['Nope'] }), rows);
      expect(pruned).toEqual(select({ technical_activity_type: [SPEC] }));
    });

    it('clears the three params when leaving the tab', () => {
      expect(clearedPipelineUrlParams()).toMatchObject({ tat: null, tech: null, ind: null });
    });
  });
});
