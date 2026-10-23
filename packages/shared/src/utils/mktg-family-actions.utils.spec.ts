// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../constants/mktg-run.constants';
import { MKTG_FAMILY_WRITE_REQUIRED } from '../constants/mktg-family-actions.constants';
import type { MktgFamilyActionContext } from '../interfaces/mktg-family-actions.interface';
import type { MktgKitFamilyView } from '../interfaces/mktg-kit.interface';
import { resolveMktgKit } from './mktg-kit.utils';
import { isMktgFamilyAgentAvailable, resolveMktgFamilyActions } from './mktg-family-actions.utils';

const context: MktgFamilyActionContext = { loaded: true, canWrite: true, approvedFramework: false };
function family(id = 'positioning-brand'): MktgKitFamilyView {
  const view = resolveMktgKit({ project: 'synthetic', groups: [] }, new Date('2026-10-23T12:00:00Z')).find((item) => item.family.id === id);
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
  it('every available never-run row has Run X; required approved documents disable it with the reason', () => {
    const result = resolveMktgFamilyActions(family(), context);
    expect(result.rows['messaging-framework'].action).toMatchObject({ kind: 'run', label: 'Run messaging framework', mode: 'new', blockedReason: '' });
    expect(result.rows['boilerplates'].action).toMatchObject({
      kind: 'run',
      label: 'Run boilerplates',
      blockedReason: 'Approve the messaging framework first: Boilerplates Agent builds on the approved one.',
    });
    expect(result.rows['one-pager'].action).toBeNull();
    expect(resolveMktgFamilyActions(family(), { ...context, approvedFramework: true }).rows['boilerplates'].action?.blockedReason).toBe('');
  });
  it('already-run living and one-off rows say Run again, with modes supported by their run pages', () => {
    for (const [id, asset, mode] of [
      ['positioning-brand', 'messaging-framework', 'new'],
      ['social-community', 'linkedin-post', null],
      ['member-sponsor', 'member-360', null],
    ] as const) {
      const result = resolveMktgFamilyActions(built(family(id)), context);
      expect(result.rows[asset].action).toMatchObject({ kind: 'run-again', label: 'Run again', mode });
    }
  });
  it('never-run one-offs get row Run and Run next agent, not a living-only exception', () => {
    for (const [id, asset, label] of [
      ['social-community', 'linkedin-post', 'LinkedIn posts'],
      ['member-sponsor', 'member-360', 'Member 360'],
    ]) {
      const result = resolveMktgFamilyActions(family(id), context);
      expect(result.rows[asset].action).toMatchObject({ kind: 'run', label: `Run ${label}`, mode: null });
      expect(result.header).toMatchObject({ kind: 'run-next', label: 'Run next agent', nextAssetLabel: label, blockedReason: '' });
    }
  });
  it('an unavailable agent has no row button and reads Coming soon, even with a registered run type', () => {
    const result = resolveMktgFamilyActions(family('website-web'), context);
    expect(result.rows['aeo-geo']).toMatchObject({ row: { state: 'coming-soon', badge: 'Coming soon' }, action: null });
    expect(result.header).toMatchObject({ kind: 'run-lead', blockedReason: 'Coming soon' });
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
      expect(resolveMktgFamilyActions(built(family()), context).header?.blockedReason).toBe('Coming soon');
    } finally {
      MKTG_AGENT_INTAKES['foundation-setup'] = intake;
    }
  });
  it('Rebuild what is stale wins over next or lead only where the rebuild panel exists', () => {
    const view = family();
    view.rows[1] = { ...view.rows[1], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, context).header).toMatchObject({ kind: 'rebuild', label: 'Rebuild what is stale' });
    const other = family('social-community');
    other.rows[0] = { ...other.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(other, context).header?.kind).toBe('run-next');
  });
  it('Run next agent follows family order and carries the same blocked reason as its row', () => {
    const view = family();
    view.rows[0] = built(view).rows[0];
    const result = resolveMktgFamilyActions(view, context);
    expect(result.header).toMatchObject({
      kind: 'run-next',
      agentId: 'boilerplates',
      nextAssetLabel: 'Boilerplates',
      blockedReason: result.rows['boilerplates'].action?.blockedReason,
    });
  });
  it('otherwise the lead header keeps Run X copy and Run again semantics', () => {
    expect(resolveMktgFamilyActions(built(family()), { ...context, approvedFramework: true }).header).toMatchObject({
      kind: 'run-lead',
      label: 'Run messaging framework',
      agentId: 'foundation-setup',
      mode: 'new',
      blockedReason: '',
    });
    expect(resolveMktgFamilyActions(family('events'), context).header).toBeNull();
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
    expect(resolveMktgFamilyActions(view, context).header).toMatchObject({
      label: 'Run Synthetic pending product',
      blockedReason: 'Synthetic unavailable reason',
    });
  });
  it('header is null until the kit read resolves, even with stale rows', () => {
    const view = family();
    view.rows[0] = { ...view.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, { ...context, loaded: false }).header).toBeNull();
  });
  it('without write access header and available row actions have one consistent reason', () => {
    for (const view of [family(), built(family()), family('social-community'), family('website-web')]) {
      const result = resolveMktgFamilyActions(view, { ...context, canWrite: false });
      expect(result.header?.blockedReason).toBe(MKTG_FAMILY_WRITE_REQUIRED);
      for (const { action } of Object.values(result.rows)) if (action) expect(action.blockedReason).toBe(MKTG_FAMILY_WRITE_REQUIRED);
    }
    const view = family();
    view.rows[0] = { ...view.rows[0], state: 'needs-rebuild' };
    expect(resolveMktgFamilyActions(view, { ...context, canWrite: false }).header?.blockedReason).toBe(MKTG_FAMILY_WRITE_REQUIRED);
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
      expect(resolveMktgFamilyActions(family('social-community'), context).header?.blockedReason).toContain('Approve the brand kit first');
      expect(resolveMktgFamilyActions(family('social-community'), { ...context, approvedSourceAgentIds: ['brand-kit'] }).header?.blockedReason).toBe('');
    } finally {
      MKTG_AGENT_INTAKES['linkedin-post'] = intake;
    }
    const view = built(family());
    const doc = view.rows[0].document;
    if (!doc) throw new Error('Missing synthetic document');
    view.rows[0] = { ...view.rows[0], document: { ...doc, approvedCurrent: { revisionId: 'approved', number: 1 } } };
    expect(resolveMktgFamilyActions(view, context).rows['boilerplates'].action?.blockedReason).toBe('');
    view.rows[0] = { ...view.rows[0], document: { ...doc, approvedCurrent: { revisionId: ' ', number: 0 } } };
    expect(resolveMktgFamilyActions(view, context).rows['boilerplates'].action?.blockedReason).toContain('Approve');
  });
  it('is deterministic and leaves the input family and catalogs untouched', () => {
    const view = family();
    const before = JSON.stringify({ view, agents: MKTG_AGENTS });
    expect(resolveMktgFamilyActions(view, context)).toEqual(resolveMktgFamilyActions(view, context));
    expect(JSON.stringify({ view, agents: MKTG_AGENTS })).toBe(before);
  });
});
