// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import type { MktgDocumentListItem, MktgDocumentsResponse } from '../interfaces/mktg-document-store.interface';
import type { MktgRevisionRef } from '../interfaces/mktg-rebuild.interface';
import { resolveMktgKit, summarizeMktgKit } from './mktg-kit.utils';
import {
  mktgRebuildDocumentTypes,
  projectMktgRebuildStaleness,
  readMktgFrameworkRef,
  readMktgRebuildNavigationIntent,
  sameMktgRevision,
} from './mktg-rebuild.utils';

const ref = (sequence = 1, hash = 'a'): MktgRevisionRef => ({
  agentKey: 'foundation-message',
  revisionId: `${String(sequence).padStart(6, '0')}-${hash.repeat(64)}`,
  revisionNumber: sequence,
  contentSha256: hash.repeat(64),
});
function document(agentKey: MktgDocumentListItem['agentKey'], upstreamFramework: MktgRevisionRef | null = ref()): MktgDocumentListItem {
  return {
    agentKey,
    documentId: 'living',
    revisionCount: 3,
    latestRevisionId: ref(2, 'b').revisionId,
    contentSha256: ref(2, 'b').contentSha256,
    currentRevisionNumber: 2,
    approvedCurrent: { revisionId: ref(2, 'b').revisionId, number: 2 },
    upstreamFramework,
    createdAt: null,
    updatedAt: null,
  };
}
function listing(documents: MktgDocumentListItem[]): MktgDocumentsResponse {
  return {
    project: 'synthetic-project',
    groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: documents.filter((entry) => entry.agentKey === type.agentKey) })),
  };
}
function projected(documents: MktgDocumentListItem[]) {
  return projectMktgRebuildStaleness(listing(documents));
}
function staleKeys(data: MktgDocumentsResponse) {
  return data.groups.flatMap((group) => group.documents.filter((entry) => entry.needsRebuild).map((entry) => entry.agentKey));
}

describe('framework provenance and rebuild projection', () => {
  it('narrows one-shot navigation intent without accepting malformed selectors or extra fields', () => {
    const intent = { project: 'synthetic-project', frameworkRevisionId: ref().revisionId };
    expect(readMktgRebuildNavigationIntent({ ...intent, extra: 'discarded' })).toEqual(intent);
    for (const value of [null, {}, { ...intent, project: '../other' }, { ...intent, frameworkRevisionId: 'bad' }])
      expect(readMktgRebuildNavigationIntent(value)).toBeNull();
  });
  it('narrows historical metadata to a valid framework identity without arbitrary fields', () => {
    expect(readMktgFrameworkRef({ ...ref(), person: 'not propagated' })).toEqual(ref());
    for (const value of [
      null,
      false,
      'text',
      [],
      {},
      { ...ref(), agentKey: 'faq' },
      { ...ref(), revisionId: '../x' },
      { ...ref(), revisionNumber: 0 },
      { ...ref(), revisionNumber: 1.5 },
      { ...ref(), revisionNumber: Number.NaN },
      { ...ref(), contentSha256: 'bad' },
    ]) {
      expect(readMktgFrameworkRef(value)).toBeNull();
    }
  });
  it('compares identity and content, never revision-number labels', () => {
    expect(sameMktgRevision(ref(), { ...ref(), revisionNumber: 9 })).toBe(true);
    expect(sameMktgRevision(ref(), { ...ref(), revisionId: ref(2).revisionId })).toBe(false);
    expect(sameMktgRevision(ref(), { ...ref(), contentSha256: ref(1, 'b').contentSha256 })).toBe(false);
  });
  it('gets the three downstream living types in family catalog order', () => {
    expect(mktgRebuildDocumentTypes().map((type) => type.agentKey)).toEqual(['boilerplates', 'faq', 'brand-kit']);
  });
  it('marks the three current downstream revisions and never a one-off or the framework', () => {
    const data = projected(
      ['foundation-message', 'boilerplates', 'faq', 'brand-kit', 'linkedin-post', 'member-360', 'aeo-geo', 'icp'].map((key) =>
        document(key as MktgDocumentListItem['agentKey'])
      )
    );
    expect(staleKeys(data).sort()).toEqual(['boilerplates', 'brand-kit', 'faq']);
    expect(data.approvedFramework).toEqual(ref(2, 'b'));
  });
  it('does not invent provenance for historical revisions or mark missing assets', () => {
    const data = projected([document('foundation-message'), document('boilerplates', null), { ...document('brand-kit'), upstreamFramework: undefined }]);
    expect(staleKeys(data)).toEqual([]);
    expect(resolveMktgKit(data)[0].rows.find((row) => row.asset.agentKey === 'faq')?.state).toBe('missing');
  });
  it('does not mark against a Draft framework or approved-but-not-current history', () => {
    for (const approvedCurrent of [null, { revisionId: ref().revisionId, number: 1 }]) {
      const data = projected([{ ...document('foundation-message'), approvedCurrent }, document('faq')]);
      expect(data.approvedFramework).toBeNull();
      expect(staleKeys(data)).toEqual([]);
    }
  });
  it('treats absent or malformed framework metadata as unknown', () => {
    for (const documents of [[document('faq')], [{ ...document('foundation-message'), contentSha256: undefined }, document('faq')]]) {
      expect(staleKeys(projected(documents))).toEqual([]);
    }
  });
  it('Make current to an older approved framework compares that pointer, not max sequence', () => {
    const framework = {
      ...document('foundation-message'),
      latestRevisionId: ref().revisionId,
      contentSha256: ref().contentSha256,
      currentRevisionNumber: 1,
      approvedCurrent: { revisionId: ref().revisionId, number: 1 },
    };
    expect(staleKeys(projected([framework, document('boilerplates')]))).toEqual([]);
    expect(staleKeys(projected([framework, document('boilerplates', ref(2, 'b'))]))).toEqual(['boilerplates']);
  });
  it('uses the dependent current revision provenance, even with newer Drafts in its history', () => {
    const current = document('faq', ref(2, 'b'));
    expect(staleKeys(projected([document('foundation-message'), { ...current, revisionCount: 10 }]))).toEqual([]);
    expect(staleKeys(projected([document('foundation-message'), { ...current, upstreamFramework: ref(), currentRevisionNumber: 1 }]))).toEqual(['faq']);
  });
  it('projects state consistently for Family and Kit without claiming rebuilt Drafts are approved', () => {
    const data = projected([document('foundation-message'), document('boilerplates'), document('faq'), document('brand-kit')]);
    const families = resolveMktgKit(data);
    expect(families[0].rows.slice(0, 4).map((row) => row.state)).toEqual(['approved', 'needs-rebuild', 'needs-rebuild', 'needs-rebuild']);
    expect(families[0].rows[1]).toMatchObject({ version: 2, badge: 'Needs rebuild' });
    expect(summarizeMktgKit(families)).toEqual({ level: null, coreFloor: 1, inKit: 1 });
  });
  it('does not mutate the listing and clears stale flags when framework no longer has an approval', () => {
    const input = listing([document('foundation-message'), document('faq')]);
    const data = projectMktgRebuildStaleness(input);
    expect(input.groups.flatMap((group) => group.documents).every((entry) => entry.needsRebuild === undefined)).toBe(true);
    const withoutApproval = {
      ...data,
      groups: data.groups.map((group) =>
        group.type.agentKey === 'foundation-message' ? { ...group, documents: group.documents.map((entry) => ({ ...entry, approvedCurrent: null })) } : group
      ),
    };
    expect(staleKeys(projectMktgRebuildStaleness(withoutApproval))).toEqual([]);
  });
});
