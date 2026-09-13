// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationChecklistMapContext, UpstreamFormationChecklist } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapUpstreamFormationChecklist } from './formation-mapper.helper';

/** One upstream checklist read — a single, already-normalized section, no items (this file only exercises the `formation`/`template` mapping, not item mapping). */
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
});
