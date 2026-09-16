// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationChecklistMapContext, FormationItemMapContext, UpstreamFormationChecklist, UpstreamFormationItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapUpstreamFormationItem, mapUpstreamFormationChecklist } from './formation-mapper.helper';

/** One upstream checklist read — a single, already-normalized section, no items (the `formation`/`template` mapping tests below don't need any; item mapping has its own fixtures further down). */
function checklist(overrides: Partial<UpstreamFormationChecklist> = {}): UpstreamFormationChecklist {
  return {
    project_uid: 'live-project-1',
    template_uid: 'template-1',
    template_version: 1,
    lifecycle: 'live',
    sections: [{ key: 'section-1', title: 'Section', position: 1 }],
    items: [],
    is_activating: false,
    ...overrides,
  };
}

/** A minimal map context — `project.stage` is the only field this spec varies. */
function mapContext(stage: string, overrides: Partial<FormationChecklistMapContext> = {}): FormationChecklistMapContext {
  return {
    project: { slug: 'live-project', name: 'Live Project', stage, legal_entity_type: 'Corporation', funding: undefined, funding_model: [] },
    parentUid: null,
    announcementDate: null,
    items: [],
    ...overrides,
  };
}

describe('mapUpstreamFormationChecklist', () => {
  // Real upstream stage strings, never short keys — short-key fixtures are how both #2366 and the
  // #2328 checklist-side default-fallthrough bug reached production undetected.
  it.each([
    ['Formation - Exploratory', 'exploratory'],
    ['Formation - Engaged', 'engaged'],
    ['Formation - On Hold', 'on_hold'],
    ['Formation - Disengaged', null],
    ['Formation - Confidential', null],
    ['Active', null],
    ['Archived', null],
    ['Prospect', null],
    ['Some Unrecognized Stage', null],
  ] as const)('normalizes project stage %s to sub_stage %s, carrying the raw string through verbatim', (rawStage, expectedSubStage) => {
    const { formation } = mapUpstreamFormationChecklist(checklist(), mapContext(rawStage));

    expect(formation.sub_stage).toBe(expectedSubStage);
    expect(formation.sub_stage_raw).toBe(rawStage);
  });

  it('never falls through to engaged for a non-Formation stage (GH-2328 regression guard)', () => {
    const { formation } = mapUpstreamFormationChecklist(checklist(), mapContext('Active'));

    expect(formation.sub_stage).not.toBe('engaged');
    expect(formation.sub_stage).toBeNull();
  });

  it('reports sub_stage null and sub_stage_raw "" when the project record has an empty stage', () => {
    const { formation } = mapUpstreamFormationChecklist(checklist(), mapContext(''));

    expect(formation.sub_stage).toBeNull();
    expect(formation.sub_stage_raw).toBe('');
  });

  it('reports sub_stage null and does not read off Object.prototype for a prototype-colliding stage string', () => {
    const { formation } = mapUpstreamFormationChecklist(checklist(), mapContext('constructor'));

    expect(formation.sub_stage).toBeNull();
    expect(formation.sub_stage_raw).toBe('constructor');
  });

  // GH-2328: lifecycle is fail-closed, the opposite of sub_stage's tolerance above.
  it.each([
    ['live', 'live'],
    ['completed', 'completed'],
    ['frozen', 'frozen'],
  ] as const)('maps upstream lifecycle %s to Formation.lifecycle %s, carrying the raw string through verbatim', (rawLifecycle, expectedLifecycle) => {
    const { formation } = mapUpstreamFormationChecklist(checklist({ lifecycle: rawLifecycle }), mapContext('Formation - Engaged'));

    expect(formation.lifecycle).toBe(expectedLifecycle);
    expect(formation.lifecycle_raw).toBe(rawLifecycle);
  });

  // The single most important mapper case: an upstream lifecycle value this repo has never seen
  // must map to `lifecycle: null` (read-only), never fall through to `'live'` — while still
  // carrying the raw string through so the read-only banner can name it.
  it('maps an invented 4th upstream lifecycle value to null, never to live, keeping the raw string', () => {
    const { formation } = mapUpstreamFormationChecklist(
      checklist({ lifecycle: 'archived' as UpstreamFormationChecklist['lifecycle'] }),
      mapContext('Formation - Engaged')
    );

    expect(formation.lifecycle).toBeNull();
    expect(formation.lifecycle_raw).toBe('archived');
  });
});

describe('mapUpstreamFormationItem', () => {
  /** One upstream checklist item — defaults to a plain, non-gating, `not_started` manual item. */
  function rawItem(overrides: Partial<UpstreamFormationItem> = {}): UpstreamFormationItem {
    return {
      uid: 'item-1',
      item_key: 'item-key-1',
      section_key: 'section-1',
      position: 1,
      title: 'Some item',
      gate: false,
      requires_writer: false,
      status_source: 'manual',
      is_required: true,
      checklist_type: 'manual',
      status: 'not_started',
      version: 1,
      ...overrides,
    };
  }

  function itemContext(overrides: Partial<FormationItemMapContext> = {}): FormationItemMapContext {
    return { formationUid: 'formation:test', projectUid: 'project:test', projectSlug: 'test-project', ...overrides };
  }

  // GH-2576: `available_actions`' `action`/`requires_relation` vocabularies grow upstream without a
  // BFF release — an unrecognized value must never be validated away or crash the decode.
  it('keeps an invented/unrecognized available_actions entry verbatim, never throwing', () => {
    const raw = rawItem({ available_actions: [{ action: 'do_something_new', requires_reason: false, requires_relation: 'some_future_relation' }] });

    expect(() => mapUpstreamFormationItem(raw, itemContext())).not.toThrow();
    const mapped = mapUpstreamFormationItem(raw, itemContext());
    expect(mapped.available_actions).toEqual([{ action: 'do_something_new', requires_reason: false, requires_relation: 'some_future_relation' }]);
  });

  it('drops a malformed available_actions entry (non-string action) instead of throwing', () => {
    const raw = rawItem({
      available_actions: [
        { action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' },
        { action: 123 as unknown as string, requires_reason: false, requires_relation: 'writer' },
      ],
    });

    const mapped = mapUpstreamFormationItem(raw, itemContext());
    expect(mapped.available_actions).toEqual([{ action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' }]);
  });

  it('defaults available_actions to an empty array when upstream omits the field', () => {
    const mapped = mapUpstreamFormationItem(rawItem(), itemContext());

    expect(mapped.available_actions).toEqual([]);
  });
});
