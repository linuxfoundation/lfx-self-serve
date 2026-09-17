// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationChecklistMapContext, FormationItemMapContext, UpstreamFormationChecklist, UpstreamFormationItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { deriveItemAction, mapUpstreamFormationItem, mapUpstreamFormationChecklist } from './formation-mapper.helper';

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
    // Deliberately untrusted payload — upstream sent a non-string `action`, expressed once at the
    // seam rather than as a per-field `as unknown as string` cast.
    const malformedActions: Record<string, unknown>[] = [
      { action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' },
      { action: 123, requires_reason: false, requires_relation: 'writer' },
    ];
    const raw = { ...rawItem(), available_actions: malformedActions } as unknown as UpstreamFormationItem;

    const mapped = mapUpstreamFormationItem(raw, itemContext());
    expect(mapped.available_actions).toEqual([{ action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' }]);
  });

  // GH-2576 review (Copilot): a malformed requires_reason must drop the entry, not silently coerce
  // to false — that would make a reason-required action look reasonless to every consumer.
  it('drops an available_actions entry with a malformed requires_reason instead of coercing it to false', () => {
    const malformedActions: Record<string, unknown>[] = [
      { action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' },
      { action: 'mark_blocked', requires_reason: 'true', requires_relation: 'formation_team_member' },
      { action: 'skip', requires_relation: 'formation_team_member' },
    ];
    const raw = { ...rawItem(), available_actions: malformedActions } as unknown as UpstreamFormationItem;

    const mapped = mapUpstreamFormationItem(raw, itemContext());
    expect(mapped.available_actions).toEqual([{ action: 'mark_done', requires_reason: false, requires_relation: 'formation_team_member' }]);
  });

  it('drops the whole field instead of throwing when upstream sends a non-array available_actions', () => {
    const raw = { ...rawItem(), available_actions: { not: 'an array' } } as unknown as UpstreamFormationItem;

    expect(() => mapUpstreamFormationItem(raw, itemContext())).not.toThrow();
    expect(mapUpstreamFormationItem(raw, itemContext()).available_actions).toEqual([]);
  });

  it('defaults available_actions to an empty array when upstream omits the field', () => {
    const mapped = mapUpstreamFormationItem(rawItem(), itemContext());

    expect(mapped.available_actions).toEqual([]);
  });

  // GH-2576 review: `evidence_link` is untrusted service output bound into `[href]` downstream — the
  // scheme guard is the reason a malformed/dangerous value never reaches the template.
  it('drops a non-http(s) evidence_link (e.g. javascript:) instead of passing it through', () => {
    const mapped = mapUpstreamFormationItem(rawItem({ evidence_link: 'javascript:alert(1)' }), itemContext());

    expect(mapped.evidence_link).toBeNull();
  });

  it('carries a valid https:// evidence_link through verbatim', () => {
    const mapped = mapUpstreamFormationItem(rawItem({ evidence_link: 'https://example.com/evidence' }), itemContext());

    expect(mapped.evidence_link).toBe('https://example.com/evidence');
  });
});

describe('deriveItemAction (GH-2613 review — status_only stranding fix)', () => {
  it('overrides a provisionable-templated item to provisionable when status_source is platform', () => {
    expect(deriveItemAction({ status_source: 'platform', item_key: 'repositories_github_owner' })).toBe('provisionable');
  });

  it('falls back to the template action for a provisionable-templated item once status_source is manual', () => {
    expect(deriveItemAction({ status_source: 'manual', item_key: 'repositories_github_owner' })).toBe('provisionable');
  });

  it('does NOT override a status_only-templated item to provisionable, even while status_source is platform — the one-way manual-write stranding hole this fix closes', () => {
    expect(deriveItemAction({ status_source: 'platform', item_key: 'domain_dns' })).toBe('status_only');
  });

  it('keeps a status_only-templated item status_only once status_source is manual', () => {
    expect(deriveItemAction({ status_source: 'manual', item_key: 'domain_dns' })).toBe('status_only');
  });

  it('defaults an unknown item_key to the manual template fallback, so it still gets the platform override (it defaults to manual, not status_only)', () => {
    expect(deriveItemAction({ status_source: 'platform', item_key: 'not-a-real-item-key' })).toBe('provisionable');
    expect(deriveItemAction({ status_source: 'manual', item_key: 'not-a-real-item-key' })).toBe('manual');
  });
});
