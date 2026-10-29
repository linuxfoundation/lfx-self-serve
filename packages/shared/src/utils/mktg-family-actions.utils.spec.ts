// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../constants/mktg-run.constants';
import { MKTG_FAMILY_WRITE_REQUIRED } from '../constants/mktg-family-actions.constants';
import type { MktgFamilyActionContext } from '../interfaces/mktg-family-actions.interface';
import type { MktgKitFamilyView } from '../interfaces/mktg-kit.interface';
import { resolveMktgKit } from './mktg-kit.utils';
import {
  isMktgFamilyAgentAvailable,
  mktgFamilyRowAction,
  mktgRunModeFor,
  resolveMktgFamilyActions,
  resolveMktgFamilyNextStep,
  resolveMktgFamilyRun,
} from './mktg-family-actions.utils';

const context: MktgFamilyActionContext = { loaded: true, canWrite: true, approvedFramework: false };
function family(id = 'positioning-brand'): MktgKitFamilyView {
  // These defensive action-policy cases also exercise hidden/unavailable catalog entries.
  const view = resolveMktgKit({ project: 'synthetic', groups: [] }, new Date('2026-10-23T12:00:00Z'), true).find((item) => item.family.id === id);
  if (!view) throw new Error('Missing synthetic family');
  return view;
}
function built(view: MktgKitFamilyView): MktgKitFamilyView {
  return {
    ...view,
    rows: view.rows.map((row) => ({
      ...row,
      document: row.asset.agentKey
        ? {
            agentKey: row.asset.agentKey,
            documentId: 'living',
            latestRevisionId: 'synthetic',
            revisionCount: 1,
            approvedCurrent: null,
            createdAt: '2026-09-10T12:00:00Z',
            updatedAt: null,
          }
        : null,
    })),
  };
}

describe('One rule for every family action', () => {
  it('overlays only known active runs, selects the newest and keeps scoped destinations in one place', () => {
    const run = {
      agentKey: 'foundation-message' as const,
      state: 'writing' as const,
      project: 'synthetic',
      documentId: 'living',
      runId: 'synthetic-run',
      startedAt: '2026-10-28T12:00:00Z',
    };
    expect(resolveMktgFamilyRun(run.agentKey)).toBeNull();
    expect(resolveMktgFamilyRun(run.agentKey, [{ ...run, state: 'failed' }])).toBeNull();
    expect(resolveMktgFamilyRun('brand-kit', [run])).toBeNull();
    expect(
      resolveMktgFamilyRun(run.agentKey, [run, { ...run, state: 'storing', runId: 'newer', startedAt: '2026-10-28T13:00:00Z' }], ['../../'])
    ).toMatchObject({
      caption: 'Writing…',
      label: 'Open',
      link: { commands: ['../../', 'documents', run.agentKey, 'living'], queryParams: { run: 'newer' } },
    });
    expect(resolveMktgFamilyRun(run.agentKey, [{ ...run, state: 'questions' }])).toMatchObject({
      caption: 'Waiting for your answers',
      label: 'Answer the questions',
      link: { commands: ['foundation-setup'], queryParams: {} },
    });
    expect(resolveMktgFamilyRun('member-360', [{ ...run, agentKey: 'member-360', state: 'questions' }])?.caption).toBe('Waiting for your answers');
  });
  it.each([
    ['foundation-message', 'foundation-setup'],
    ['linkedin-post', 'linkedin-post'],
    ['member-360', 'member-360'],
  ] as const)('answers %s questions on its catalog run page', (agentKey, catalogAgentId) => {
    const run = {
      agentKey,
      state: 'questions' as const,
      project: 'synthetic',
      documentId: 'one-off-document',
      runId: 'synthetic-run',
      startedAt: '2026-10-28T12:00:00Z',
    };
    expect(resolveMktgFamilyRun(agentKey, [run], ['../../'])).toEqual({
      caption: 'Waiting for your answers',
      label: 'Answer the questions',
      link: { commands: ['../../', catalogAgentId], queryParams: {} },
    });
  });
  it.each(['writing', 'storing', 'questions'] as const)('preserves approved current while presenting %s without changing its link', (state) => {
    const run = {
      agentKey: 'foundation-message' as const,
      state,
      project: 'synthetic',
      documentId: 'living',
      runId: 'synthetic-run',
      startedAt: '2026-10-28T12:00:00Z',
    };
    const document = {
      agentKey: run.agentKey,
      documentId: 'living',
      revisionCount: 2,
      latestRevisionId: 'approved',
      approvedCurrent: { revisionId: 'approved', number: 2 },
      createdAt: null,
      updatedAt: null,
    };
    const result = resolveMktgFamilyRun(run.agentKey, [run], [], document);
    expect(result?.caption).toBe(state === 'questions' ? 'Waiting for your answers' : 'Approved · new version being written');
    expect(result?.link).toEqual(resolveMktgFamilyRun(run.agentKey, [run])?.link);
    expect(document.approvedCurrent).toEqual({ revisionId: 'approved', number: 2 });
    for (const approvedCurrent of [
      null,
      { revisionId: '', number: 2 },
      { revisionId: ' ', number: 2 },
      { revisionId: 'approved', number: 0 },
      { revisionId: 'approved', number: 1.5 },
    ]) {
      expect(resolveMktgFamilyRun(run.agentKey, [run], [], { ...document, approvedCurrent })?.caption).toBe(
        state === 'questions' ? 'Waiting for your answers' : 'Writing…'
      );
    }
    expect(resolveMktgFamilyRun(run.agentKey, [run], [], null)?.caption).toBe(state === 'questions' ? 'Waiting for your answers' : 'Writing…');
    expect(resolveMktgFamilyRun(run.agentKey, [run], [], { ...document, documentId: 'other' })?.caption).toBe(
      state === 'questions' ? 'Waiting for your answers' : 'Writing…'
    );
  });
  it('every available never-run row has Create X; required approved documents disable it with the reason', () => {
    const result = resolveMktgFamilyActions(family(), context);
    expect(result.rows['messaging-framework'].action).toMatchObject({ kind: 'run', label: 'Create messaging framework', mode: 'new', blockedReason: '' });
    expect(result.rows['boilerplates'].action).toMatchObject({
      kind: 'run',
      label: 'Create boilerplates',
      blockedReason: 'after the framework is approved',
    });
    expect(result.rows['one-pager'].action).toBeNull();
    expect(resolveMktgFamilyActions(family(), { ...context, approvedFramework: true }).rows['boilerplates'].action?.blockedReason).toBe('');
  });
  it('existing living and one-off rows have no action; document Run again retains its entry modes', () => {
    for (const [id, asset, mode] of [
      ['positioning-brand', 'messaging-framework', 'new'],
      ['social-community', 'linkedin-post', 'new'],
      ['member-sponsor', 'member-360', null],
    ] as const) {
      const result = resolveMktgFamilyActions(built(family(id)), context);
      expect(result.rows[asset].action).toBeNull();
      const agentId = id === 'positioning-brand' ? 'foundation-setup' : asset;
      expect(mktgRunModeFor(agentId)).toBe(mode);
    }
  });
  it('one-off families always offer Create on a plain route, regardless of history', () => {
    for (const [id, asset, label] of [
      ['social-community', 'linkedin-post', 'LinkedIn post'],
      ['member-sponsor', 'member-360', 'Member 360'],
    ]) {
      const result = resolveMktgFamilyActions(family(id), context);
      expect(result.rows[asset].action).toMatchObject({ kind: 'run', label: `Create ${label}`, mode: id === 'social-community' ? 'new' : null });
      expect(result.header).toMatchObject({ kind: 'create', label: `Create ${label}`, mode: null });
      expect(resolveMktgFamilyActions(built(family(id)), context).header).toEqual(result.header);
    }
  });
  it('an unavailable agent has no row button and reads Coming soon, even with a registered run type', () => {
    const agent = MKTG_AGENTS.find((entry) => entry.id === 'aeo-geo');
    if (!agent) throw new Error('Missing synthetic catalog agent');
    const status = agent.status;
    agent.status = 'coming-soon';
    try {
      const result = resolveMktgFamilyActions(family('website-web'), context);
      expect(result.rows['aeo-geo']).toMatchObject({ row: { state: 'coming-soon', badge: 'Coming soon' }, action: null });
      expect(result.header).toBeNull();
    } finally {
      agent.status = status;
    }
    expect(isMktgFamilyAgentAvailable('icp')).toBe(false);
    expect(isMktgFamilyAgentAvailable('not-registered')).toBe(false);
    const excluded = family();
    excluded.rows[0] = { ...excluded.rows[0], asset: { ...excluded.rows[0].asset, agentKey: 'icp' } };
    expect(resolveMktgFamilyActions(excluded, context).rows['messaging-framework'].action).toBeNull();
  });
  it('active catalog entries without an intake remain unavailable', () => {
    const intake = MKTG_AGENT_INTAKES['foundation-setup'];
    delete MKTG_AGENT_INTAKES['foundation-setup'];
    try {
      expect(isMktgFamilyAgentAvailable('foundation-setup')).toBe(false);
      expect(mktgFamilyRowAction(family().rows[0], context).action).toBeNull();
    } finally {
      MKTG_AGENT_INTAKES['foundation-setup'] = intake;
    }
  });
  it('Update stale assets wins only where the rebuild panel exists, with singular and plural copy', () => {
    const view = family();
    view.rows[1] = { ...view.rows[1], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, context).header).toMatchObject({ kind: 'rebuild', label: 'Update boilerplates' });
    view.rows[0] = { ...view.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, context).header?.label).toBe('Update 2 assets');
    const other = family('social-community');
    other.rows[0] = { ...other.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(other, context).header?.kind).toBe('create');
  });
  it('a blocked next step links to its required document instead of disabling the header', () => {
    const view = family();
    view.rows[0] = built(view).rows[0];
    const result = resolveMktgFamilyActions(view, context);
    expect(result.header).toMatchObject({
      kind: 'blocked',
      agentId: null,
      label: 'Review and approve the framework',
      caption: 'Then: boilerplates, FAQ and the brand kit',
      link: { commands: ['../../documents', 'foundation-message', 'living'], queryParams: {} },
    });
    view.rows[1] = built(view).rows[1];
    expect(resolveMktgFamilyActions(view, context).header?.caption).toBe('Then: FAQ and the brand kit');
  });
  it('nothing to create means Review drafts, then Export the kit only for approved fresh exportable families', () => {
    const view = built(family());
    view.rows[0].state = 'draft';
    expect(resolveMktgFamilyActions(view, context).header).toMatchObject({
      kind: 'review',
      label: 'Review the draft',
      link: { commands: ['../../documents', 'foundation-message', 'living'] },
    });
    view.rows[1].state = 'draft';
    expect(resolveMktgFamilyActions(view, context).header?.label).toBe('Review 2 drafts');
    view.rows.forEach((row) => (row.state = 'approved'));
    expect(resolveMktgFamilyActions(view, context).header).toEqual({ kind: 'export', label: 'Export the kit', agentId: null, mode: null, link: null });
    const unsupported = { ...view, family: { ...view.family, id: 'synthetic-no-exporter' } };
    expect(resolveMktgFamilyActions(unsupported, context).header).toBeNull();
    view.rows[0].state = 'needs-rebuild';
    expect(resolveMktgFamilyActions(view, context).header?.kind).toBe('rebuild');
    expect(resolveMktgFamilyActions(family('events'), context).header).toBeNull();
  });
  it('Create names the first not-built available asset and preserves living fresh mode', () => {
    expect(resolveMktgFamilyActions(family(), context).header).toMatchObject({
      kind: 'create',
      label: 'Create messaging framework',
      agentId: 'foundation-setup',
      mode: 'new',
    });
    expect(resolveMktgFamilyActions(family(), context).header?.caption).toBeUndefined();
  });
  it.each([
    ['positioning-brand', 'Run messaging framework'],
    ['social-community', 'Run LinkedIn posts'],
    ['member-sponsor', 'Run Member 360'],
  ])('reader headers are hidden for %s even when the denied read has no rows', (id) => {
    const view = { ...family(id), rows: [] };
    const result = resolveMktgFamilyActions(view, { ...context, canWrite: false });
    expect(result.header).toBeNull();
    expect(result.rows).toEqual({});
  });
  it('unavailable leads use declared pending copy, even without catalog membership', () => {
    const view = family('member-sponsor');
    view.family = {
      ...view.family,
      agentIds: ['unregistered'],
      pendingAgentName: 'Synthetic pending product',
      pendingAgentReason: 'Synthetic unavailable reason',
    };
    view.rows = [];
    expect(resolveMktgFamilyActions(view, context).header).toBeNull();
  });
  it('header is null until the kit read resolves, even with stale rows', () => {
    const view = family();
    view.rows[0] = { ...view.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, { ...context, loaded: false }).header).toBeNull();
  });
  it('without write access headers are hidden and not-built rows explain why inline', () => {
    for (const view of [family(), built(family()), family('social-community'), family('website-web')]) {
      const result = resolveMktgFamilyActions(view, { ...context, canWrite: false });
      expect(result.header).toBeNull();
      for (const { action } of Object.values(result.rows)) if (action) expect(action.blockedReason).toBe(MKTG_FAMILY_WRITE_REQUIRED);
    }
    const view = family();
    view.rows[0] = { ...view.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, { ...context, canWrite: false }).header).toBeNull();
  });
  it('required non-framework JSON sources use real approval, optional sources never block', () => {
    const intake = MKTG_AGENT_INTAKES['linkedin-post'];
    MKTG_AGENT_INTAKES['linkedin-post'] = {
      ...intake,
      attachments: [
        { sourceAgentId: 'brand-kit', documentName: 'Brand kit', answerKey: 'kit', format: 'json' },
        { sourceAgentId: 'missing', documentName: 'Optional document', answerKey: 'optional', format: 'json', optional: true },
      ],
    };
    try {
      expect(resolveMktgFamilyActions(family('social-community'), context).header?.label).toBe('Review and approve the brand kit');
      expect(resolveMktgFamilyActions(family('social-community'), { ...context, approvedSourceAgentIds: ['brand-kit'] }).header?.kind).toBe('create');
    } finally {
      MKTG_AGENT_INTAKES['linkedin-post'] = intake;
    }
    const view = family();
    view.rows[0] = built(view).rows[0];
    const doc = view.rows[0].document;
    if (!doc) throw new Error('Missing synthetic document');
    view.rows[0] = { ...view.rows[0], document: { ...doc, approvedCurrent: { revisionId: 'approved', number: 1 } } };
    expect(resolveMktgFamilyActions(view, context).rows['boilerplates'].action?.blockedReason).toBe('');
    view.rows[0] = { ...view.rows[0], document: { ...doc, approvedCurrent: { revisionId: ' ', number: 0 } } };
    expect(resolveMktgFamilyActions(view, context).rows['boilerplates'].action?.blockedReason).toBe('after the framework is approved');
    view.rows[0] = { ...view.rows[0], document: { ...doc, approvedCurrent: { revisionId: 42 as unknown as string, number: 1 } } };
    expect(resolveMktgFamilyActions(view, context).rows['boilerplates'].action?.blockedReason).toBe('after the framework is approved');
  });
  it('presents create destinations relative to Kit, with fresh run mode and honest copy', () => {
    const step = resolveMktgFamilyNextStep(family(), context);
    expect(step).toMatchObject({
      header: { kind: 'create', label: 'Create messaging framework' },
      commands: ['foundation-setup'],
      queryParams: { mode: 'new' },
      sentence: 'Nothing in the kit yet; create the messaging framework to start.',
      hint: 'Opens the messaging framework run page in Positioning & brand.',
    });
    const view = built(family());
    view.rows[1].document = null;
    expect(resolveMktgFamilyNextStep(view, { ...context, approvedFramework: true })?.sentence).toBe('Create the boilerplates next.');
  });
  it('presents blocked framework approval without creating a second action policy', () => {
    const view = family();
    view.rows[0] = { ...built(view).rows[0], state: 'draft' };
    const step = resolveMktgFamilyNextStep(view, context);
    expect(step?.header).toEqual(resolveMktgFamilyActions(view, context).header);
    expect(step?.commands).toEqual(['documents', 'foundation-message', 'living']);
    expect(step?.sentence).toBe('The messaging framework is drafted; approve it so boilerplates, FAQ and the brand kit can be created.');
    expect(step?.hint).toBe('Opens the framework document in Positioning & brand.');
  });
  it.each([true, false])('mentions only missing dependants, never drafts already created (all drafted=%s)', (allDrafted) => {
    const view = built(family());
    for (const row of view.rows) if (row.document) row.state = 'draft';
    if (!allDrafted) view.rows[2].document = null;
    expect(resolveMktgFamilyNextStep(view, context)?.sentence).toBe(
      allDrafted ? 'The messaging framework is drafted; approve it.' : 'The messaging framework is drafted; approve it so FAQ can be created.'
    );
  });
  it('presents review and rebuild and hides steps when none are actionable', () => {
    const view = built(family());
    view.rows[0].state = 'draft';
    expect(resolveMktgFamilyNextStep(view, context)).toMatchObject({ header: { kind: 'review' }, commands: ['documents', 'foundation-message', 'living'] });
    view.rows[1].state = 'needs-rebuild';
    expect(resolveMktgFamilyNextStep(view, context)).toMatchObject({
      header: { kind: 'rebuild' },
      sentence: '1 asset is stale; rebuild it.',
      hint: 'Opens Positioning & brand, where the stale assets are rebuilt.',
      commands: ['families', view.family.id],
    });
    view.rows[2].state = 'needs-rebuild';
    expect(resolveMktgFamilyNextStep(view, context)?.sentence).toBe('2 assets are stale; rebuild them.');
    expect(resolveMktgFamilyNextStep(view, { ...context, loaded: false })).toBeNull();
    expect(resolveMktgFamilyNextStep(view, { ...context, canWrite: false })).toBeNull();
    expect(resolveMktgFamilyNextStep(family('content-video'), context)).toBeNull();
  });
  it('presents the export header with an honest destination, without starting an export', () => {
    const view = built(family());
    for (const row of view.rows) row.state = 'approved';
    const step = resolveMktgFamilyNextStep(view, context);
    expect(step?.header).toEqual(resolveMktgFamilyActions(view, context).header);
    expect(step).toMatchObject({
      header: { kind: 'export', label: 'Export the kit' },
      sentence: 'The kit is complete; export it.',
      hint: 'Opens Positioning & brand, where the kit can be exported.',
      commands: ['families', view.family.id],
      queryParams: {},
    });
  });
  it('is deterministic and leaves the input family and catalogs untouched', () => {
    const view = family();
    const before = JSON.stringify({ view, agents: MKTG_AGENTS });
    expect(resolveMktgFamilyActions(view, context)).toEqual(resolveMktgFamilyActions(view, context));
    expect(JSON.stringify({ view, agents: MKTG_AGENTS })).toBe(before);
  });
});
