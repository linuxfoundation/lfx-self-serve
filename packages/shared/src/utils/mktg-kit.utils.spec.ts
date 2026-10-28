// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_EXCLUDED_AGENT_IDS, MKTG_KIT_EXCLUDED_DOCUMENT_KEYS, MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import type { MktgDocumentListItem, MktgDocumentsResponse } from '../interfaces/mktg-document-store.interface';
import {
  describeMktgKitAsset,
  isMktgKitFamilyLive,
  mktgKitCurrentVersion,
  mktgKitAssetLabel,
  mktgKitSources,
  mktgKitRunDate,
  resolveMktgKit,
  resolveMktgKitAsset,
  resolveMktgKitLivingState,
  summarizeMktgKit,
} from './mktg-kit.utils';

function document(agentKey: MktgDocumentListItem['agentKey'], createdAt: string | null = '2026-10-01T12:00:00Z'): MktgDocumentListItem {
  return {
    agentKey,
    documentId: 'living',
    revisionCount: 12,
    latestRevisionId: '000003-' + 'a'.repeat(64),
    approvedCurrent: null,
    updatedAt: '2026-10-16T12:00:00Z',
    createdAt,
  };
}
function listing(documents: MktgDocumentListItem[] = []): MktgDocumentsResponse {
  return { project: 'synthetic', groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: documents.filter((doc) => doc.agentKey === type.agentKey) })) };
}

describe('Marketing kit plan of record', () => {
  it('uses the Main board order and the explicit document/agent exclusions only', () => {
    expect(MKTG_KIT_FAMILIES.map((family) => family.id)).toEqual([
      'positioning-brand',
      'website-web',
      'social-community',
      'member-sponsor',
      'plan-committee-measurement',
      'lists-newsletter',
      'content-video',
      'pr-analyst-launch',
      'events',
    ]);
    expect(MKTG_KIT_FAMILIES.filter((family) => family.runOrder).map((family) => [family.id, family.runOrder])).toEqual([
      ['positioning-brand', 'Run in order: framework first, then the three that read it'],
    ]);
    expect(MKTG_KIT_EXCLUDED_DOCUMENT_KEYS).toEqual(['icp']);
    expect(MKTG_KIT_EXCLUDED_AGENT_IDS).toEqual(['icp', 'website-builder']);
    const ids = MKTG_KIT_FAMILIES.flatMap((family) => family.agentIds);
    expect(ids.filter((id) => !MKTG_AGENTS.some((agent) => agent.id === id))).toEqual([]);
    expect(ids.filter((id) => MKTG_AGENTS.some((agent) => agent.id === id)).sort()).toEqual(
      MKTG_AGENTS.filter((agent) => !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id))
        .map((agent) => agent.id)
        .sort()
    );
    expect(new Set(ids).size).toBe(ids.length);
    const keys = MKTG_KIT_FAMILIES.flatMap((family) => family.assets.map((asset) => asset.agentKey));
    for (const type of MKTG_DOCUMENT_TYPES) expect([...keys, ...MKTG_KIT_EXCLUDED_DOCUMENT_KEYS]).toContain(type.agentKey);
    expect(keys).not.toContain('icp');
    expect(MKTG_KIT_FAMILIES[0].agentIds).toEqual(['foundation-setup', 'boilerplates', 'faq', 'brand-kit']);
  });
  it('keeps board Run wording separate from catalog agent identities and row headings', () => {
    expect(mktgKitAssetLabel('brand-kit')).toBe('Brand kit');
    expect(mktgKitAssetLabel('not-registered')).toBeUndefined();
    expect(MKTG_KIT_FAMILIES[0].assets.filter((asset) => asset.runName !== undefined).map((asset) => [asset.label, asset.runName])).toEqual([
      ['Messaging framework', 'messaging framework'],
      ['Boilerplates', 'boilerplates'],
      ['FAQ', 'FAQ'],
      ['Brand kit', 'brand kit'],
    ]);
  });

  it('keeps legacy ICP documents out of the kit and its summary', () => {
    const families = resolveMktgKit(listing([document('icp')]));
    expect(families.flatMap((family) => family.rows).some((row) => row.asset.agentKey === 'icp')).toBe(false);
    expect(summarizeMktgKit(families).inKit).toBe(0);
  });
  it('uses store-backed liveness for the live Boilerplates and FAQ types', () => {
    expect(isMktgKitFamilyLive(MKTG_KIT_FAMILIES[0])).toBe(true);
    expect(isMktgKitFamilyLive({ ...MKTG_KIT_FAMILIES[0], assets: [] })).toBe(false);
    const families = resolveMktgKit(listing());
    expect(families.filter((family) => family.live)).toHaveLength(4);
    expect(families[0].rows.map((row) => row.state)).toEqual(['missing', 'missing', 'missing', 'missing', 'coming-soon']);
    expect(families[0].rows[1].asset.agentKey).toBe('boilerplates');
    expect(families[0].rows[2].asset.agentKey).toBe('faq');
  });
  it('declares the Member 360 catalog entry and its run document', () => {
    const family = resolveMktgKit(listing()).find((entry) => entry.family.id === 'member-sponsor');
    expect(family?.family.agentIds).toEqual(['member-360', 'pitch-deck']);
    expect(family?.agents[0]).toEqual(MKTG_AGENTS.find((agent) => agent.id === 'member-360'));
    expect(family?.agents.map((agent) => agent.id)).toEqual(['member-360', 'pitch-deck']);
    expect(family?.rows.map((row) => row.asset.agentKey)).toContain('member-360');
  });
  it('derives Current from the latest sequence, never from revisionCount', () => {
    expect(mktgKitCurrentVersion(document('foundation-message'))).toBe(3);
    expect(mktgKitCurrentVersion({ ...document('foundation-message'), latestRevisionId: 'legacy-' + 'a'.repeat(64) })).toBeNull();
    expect(mktgKitCurrentVersion({ ...document('brand-kit'), latestRevisionId: 'invalid' })).toBeNull();
    const families = resolveMktgKit(listing([document('foundation-message'), document('boilerplates'), document('brand-kit')]));
    expect(families[0].rows[0]).toMatchObject({ state: 'draft', version: 3, badge: 'Draft' });
    expect(summarizeMktgKit(families)).toEqual({ level: null, coreFloor: 0, inKit: 0 });
    expect(summarizeMktgKit(resolveMktgKit(listing([document('brand-kit')]))).level).toBeNull();
  });
  it('prefers the displayed Current number when the selected id sequence differs', () => {
    expect(mktgKitCurrentVersion({ ...document('brand-kit'), currentRevisionNumber: 2 })).toBe(2);
    for (const currentRevisionNumber of [0, -1, 1.5, Number.NaN]) {
      expect(mktgKitCurrentVersion({ ...document('brand-kit'), currentRevisionNumber })).toBe(3);
    }
  });
  it('counts only real approvedCurrent values, not drafts or run documents', () => {
    const approved = (key: MktgDocumentListItem['agentKey']): MktgDocumentListItem => ({
      ...document(key),
      approvedCurrent: { revisionId: 'approved-revision', number: 2 },
    });
    const families = resolveMktgKit(
      listing([approved('foundation-message'), approved('boilerplates'), approved('faq'), approved('brand-kit'), approved('linkedin-post')])
    );
    expect(families[0].rows[0]).toMatchObject({ state: 'approved', version: 2, badge: 'Approved · v2' });
    expect(summarizeMktgKit(families)).toEqual({ level: 'Core', coreFloor: 1, inKit: 4 });
    expect(summarizeMktgKit([...families].reverse()).level).toBe('Core');
    expect(summarizeMktgKit(resolveMktgKit(listing([approved('brand-kit'), document('foundation-message')])))).toEqual({ level: null, coreFloor: 1, inKit: 1 });
    for (const approvedCurrent of [
      null,
      { revisionId: '', number: 2 },
      { revisionId: ' ', number: 2 },
      { revisionId: 'r', number: 0 },
      { revisionId: 'r', number: -1 },
      { revisionId: 'r', number: 1.5 },
    ]) {
      expect(resolveMktgKitLivingState({ ...document('brand-kit'), approvedCurrent })).toMatchObject({ state: 'draft', version: 3 });
    }
    expect(summarizeMktgKit([])).toEqual({ level: null, coreFloor: 0, inKit: 0 });
  });
  it('counts one-off runs by UTC calendar month, never marking them stale', () => {
    const data = listing([
      document('linkedin-post'),
      document('linkedin-post', '2026-10-31T12:00:00Z'),
      document('linkedin-post', '2026-09-30T12:00:00Z'),
      document('linkedin-post', '2025-10-01T12:00:00'),
      document('linkedin-post', null),
    ]);
    const row = resolveMktgKitAsset(MKTG_KIT_FAMILIES[2].assets[0], data, new Date(2026, 9, 19));
    expect(row).toMatchObject({ state: null, monthlyCount: 2, version: null, badge: '2 this month' });
    expect(summarizeMktgKit(resolveMktgKit(data)).inKit).toBe(0);
    expect(resolveMktgKitAsset(MKTG_KIT_FAMILIES[2].assets[0], listing()).badge).toBe('Not run yet');
  });
  it('Not run yet means never run; prior one-offs have a deterministic last-run label and no approval filter state', () => {
    const asset = MKTG_KIT_FAMILIES[2].assets[0];
    const now = new Date('2026-10-23T12:00:00Z');
    expect(resolveMktgKitAsset(asset, listing(), now)).toMatchObject({ state: 'missing', badge: 'Not run yet', monthlyCount: 0 });
    const data = listing([document('linkedin-post', '2026-08-01T12:00:00Z'), document('linkedin-post', '2026-09-10T12:00:00Z')]);
    expect(resolveMktgKitAsset(asset, data, now)).toMatchObject({ state: null, badge: 'Last run 10 Sep', monthlyCount: 0 });
    expect(data.groups.find((group) => group.type.agentKey === 'linkedin-post')?.documents[0].createdAt).toBe('2026-08-01T12:00:00Z');
    expect(resolveMktgKitAsset(asset, listing([document('linkedin-post', null)]), now).badge).toBe('Last run —');
    expect(mktgKitRunDate('2026-10-01T00:30:00+02:00')).toBe('30 Sep');
    expect(mktgKitRunDate('invalid')).toBe('—');
    expect(mktgKitRunDate(null)).toBe('—');
  });
  it('uses UTC for both month counts and last-run labels across a local month boundary', () => {
    const asset = MKTG_KIT_FAMILIES[2].assets[0];
    const now = new Date('2026-10-01T00:30:00Z');
    const october = resolveMktgKitAsset(asset, listing([document('linkedin-post', '2026-09-30T23:45:00-02:00')]), now);
    expect(october).toMatchObject({ monthlyCount: 1, badge: '1 this month' });
    expect(mktgKitRunDate(october.document?.createdAt)).toBe('1 Oct');
    const september = resolveMktgKitAsset(asset, listing([document('linkedin-post', '2026-10-01T00:15:00+02:00')]), now);
    expect(september).toMatchObject({ monthlyCount: 0, badge: 'Last run 30 Sep' });
    expect(mktgKitRunDate(september.document?.createdAt)).toBe('30 Sep');
  });
  it('registered types with an unavailable agent read Coming soon instead of Not run yet or a run count', () => {
    const asset = MKTG_KIT_FAMILIES[1].assets[0];
    expect(resolveMktgKitAsset(asset, listing([document('aeo-geo')]))).toMatchObject({ state: 'coming-soon', badge: 'Coming soon', monthlyCount: null });
  });
  it('renders exact board state labels, with approval reserved for its real producer', () => {
    expect(describeMktgKitAsset({ state: 'approved', version: 3, monthlyCount: null })).toBe('Approved · v3');
    for (const [state, label] of [
      ['draft', 'Draft'],
      ['needs-rebuild', 'Needs rebuild'],
      ['missing', 'Not run yet'],
      ['coming-soon', 'Coming soon'],
    ] as const) {
      expect(describeMktgKitAsset({ state, version: 3, monthlyCount: null })).toBe(label);
    }
    expect(
      resolveMktgKit(listing([document('brand-kit')]))
        .flatMap((family) => family.rows)
        .some((row) => row.state === 'approved' || row.state === 'needs-rebuild')
    ).toBe(false);
  });
  it('reads only the framework report source fields and omits absent or malformed data', () => {
    expect(
      mktgKitSources({ report: { sources_read: ['project.example', 'Synthetic plan'], sources_failed: [{ name: 'README', reason: 'Timed out' }] } })
    ).toEqual({
      readCount: 2,
      failedCount: 1,
      readText: 'Sources read on the last run: project.example, Synthetic plan.',
      failedText: '1 source failed: README: Timed out.',
    });
    expect(
      mktgKitSources({
        report: {
          sources_read: [],
          sources_failed: [
            { name: 'README', reason: 'Timed out' },
            { name: 'Plan', reason: 'Unavailable' },
          ],
        },
      })?.failedText
    ).toBe('2 sources failed: README: Timed out; Plan: Unavailable.');
    expect(mktgKitSources(null)).toBeNull();
    expect(mktgKitSources({})).toBeNull();
    expect(mktgKitSources({ report: { sources_read: [123], sources_failed: [] } })).toBeNull();
    expect(mktgKitSources({ report: { sources_read: [], sources_failed: [{ name: 'README' }] } })).toBeNull();
    expect(mktgKitSources({ report: { sources_read: [], sources_failed: [] } })).toBeNull();
  });
});
