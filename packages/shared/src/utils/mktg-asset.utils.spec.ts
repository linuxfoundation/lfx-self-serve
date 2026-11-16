// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_HOST_ASSET_STATES } from '../constants/mktg-asset.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import type { MktgRevisionResponse, MktgRevisionSummary } from '../interfaces/mktg-document-store.interface';
import {
  describeMktgAcceptedGaps,
  describeMktgAcceptedItem,
  describeMktgAssetReadiness,
  mktgAcceptedSnapshotOf,
  mktgAssetHeaderFallback,
  mktgAssetHeaderMetadata,
  mktgWarningAcceptedKey,
  readMktgRevisionAccepted,
} from './mktg-asset.utils';

describe('Asset readiness', () => {
  it('uses singular source when the only source failed', () => {
    expect(describeMktgAssetReadiness({ sources_read: [], sources_failed: [{ name: 'Docs', reason: '404' }], gaps: [], notes: '' })).toBe(
      'Ready — 1 of 1 source could not be read.'
    );
  });
  it.each([
    [0, 0, 'Ready.'],
    [1, 0, 'Ready — 1 of 3 sources could not be read.'],
    [0, 1, 'Ready — 1 gap.'],
    [0, 2, 'Ready — 2 gaps.'],
    [2, 1, 'Ready — 2 of 4 sources could not be read; 1 gap.'],
    [2, 2, 'Ready — 2 of 4 sources could not be read; 2 gaps.'],
  ] as const)('counts %i failed sources and %i gaps', (failed, gaps, expected) => {
    expect(
      describeMktgAssetReadiness({
        sources_read: ['Docs', 'Website'],
        sources_failed: Array.from({ length: failed }, () => ({ name: 'Members', reason: 'Unavailable' })),
        gaps: Array.from({ length: gaps }, () => 'Missing evidence'),
        notes: '',
      })
    ).toBe(expected);
  });
});

describe('Accepted gaps caption', () => {
  const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: null };
  const withGaps = { sources_read: ['Docs'], sources_failed: [], gaps: ['Missing evidence'], notes: '' };

  it('names the approved version under its still-open gaps', () => {
    expect(describeMktgAcceptedGaps(withGaps, approval, 3)).toBe('Accepted when v3 was approved; still open.');
  });
  it('drops the version when none is known', () => {
    expect(describeMktgAcceptedGaps(withGaps, approval, null)).toBe('Accepted at approval; still open.');
  });
  it('says nothing when the revision is not approved, has no gap or has no report', () => {
    expect(describeMktgAcceptedGaps(withGaps, null, 3)).toBeNull();
    expect(describeMktgAcceptedGaps({ ...withGaps, gaps: [] }, approval, 3)).toBeNull();
    expect(describeMktgAcceptedGaps(null, approval, 3)).toBeNull();
  });
});

describe('The approval snapshot', () => {
  it('takes the stable keys out of a v2 report: sources, assets, code|text, gap text, conflict name', () => {
    const snapshot = mktgAcceptedSnapshotOf({
      sources_read: [],
      sources_failed: [{ name: 'legacy.svg', reason: 'cut' }],
      gaps: ['A gap.', 42],
      notes: '',
      findings: {
        sources_failed: [{ source: 'https://a.example/brand', kind: 'brand_page', reason: 'Gone.' }, { kind: 'page' }],
        missing_assets: [{ asset: 'logo_stacked', reason: 'None.' }, 'junk'],
        warnings: [{ code: 'font_unverified', text: 'Unverified.' }, { code: 'no_text' }],
      },
      color_conflicts: [{ name: 'Coral', values: [], chosen: '#FF702D' }, { values: [] }],
    });
    expect(snapshot).toEqual({
      sources_failed: ['https://a.example/brand'],
      missing_assets: ['logo_stacked'],
      warnings: ['font_unverified|Unverified.'],
      gaps: ['A gap.'],
      color_conflicts: ['Coral'],
    });
  });

  it('falls back to the v1 failed names when there are no findings, and to empty lists when there is no report', () => {
    expect(mktgAcceptedSnapshotOf({ sources_failed: [{ name: 'logo.zip', reason: 'cut' }], gaps: [] })).toEqual({
      sources_failed: ['logo.zip'],
      missing_assets: [],
      warnings: [],
      gaps: [],
      color_conflicts: [],
    });
    expect(mktgAcceptedSnapshotOf(undefined)).toEqual({ sources_failed: [], missing_assets: [], warnings: [], gaps: [], color_conflicts: [] });
  });

  it('reads a stored snapshot back only when all five lists are lists of strings', () => {
    const good = { sources_failed: [], missing_assets: ['logo_stacked'], warnings: [], gaps: ['A gap.'], color_conflicts: [] };
    expect(readMktgRevisionAccepted(good)).toEqual(good);
    expect(readMktgRevisionAccepted({ ...good, extra: true })).toEqual(good);
    expect(readMktgRevisionAccepted({ ...good, gaps: 'A gap.' })).toBeNull();
    expect(readMktgRevisionAccepted({ ...good, warnings: [1] })).toBeNull();
    const { color_conflicts, ...missing } = good;
    void color_conflicts;
    expect(readMktgRevisionAccepted(missing)).toBeNull();
    expect(readMktgRevisionAccepted(null)).toBeNull();
    expect(readMktgRevisionAccepted([])).toBeNull();
  });

  it('words the marker with the version when known', () => {
    expect(describeMktgAcceptedItem(3)).toBe('Accepted when v3 was approved');
    expect(describeMktgAcceptedItem(null)).toBe('Accepted at approval');
    expect(mktgWarningAcceptedKey({ code: 'color_conflict', text: 'Coral differs.' })).toBe('color_conflict|Coral differs.');
  });
});

describe('Common asset header metadata and host states', () => {
  function headerView(): MktgRevisionResponse {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'brand-kit');
    if (!type) throw new Error('Missing synthetic document type');
    const revision: MktgRevisionSummary = {
      id: `000003-${'c'.repeat(64)}`,
      number: 3,
      createdAt: '2026-10-19T10:00:00Z',
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: 'Draft',
      contentSha256: 'c'.repeat(64),
      format: 'json',
      commentCount: 0,
      latest: false,
      author: { name: 'Generation role' },
      approval: null,
    };
    const approved = {
      ...revision,
      id: `000002-${'b'.repeat(64)}`,
      number: 2,
      latest: true,
      approval: { approvedAt: '2026-10-19T09:00:00Z', approvedBy: null },
    };
    return {
      project: 'synthetic-project',
      type,
      documentId: 'living',
      revision,
      revisions: [revision, approved],
      approval: null,
      approvedCurrent: { revisionId: approved.id, number: 2 },
      markdown: '{}',
      sidecar: null,
      current: { revisionId: approved.id, changedAt: '2026-10-19T09:30:00Z', changedBy: { name: 'Selection role' } },
    };
  }

  it('uses the viewed version/date/catalog agent without substituting generator or selector for an approver', () => {
    const view = headerView();
    expect(mktgAssetHeaderMetadata(view)).toEqual({
      version: 3,
      agentName: view.type.agentName,
      createdAt: view.revision.createdAt,
      approval: null,
      otherApprovedCurrent: { number: 2, approvedBy: null },
    });
  });

  it('derives approval from its annotation independently of Make current', () => {
    const view = headerView();
    expect(mktgAssetHeaderMetadata({ ...view, approvedCurrent: null, revision: { ...view.revision, latest: true } }).approval).toBeNull();
    const selected = view.revisions.find((revision) => revision.approval);
    if (!selected) throw new Error('Missing synthetic approval');
    expect(mktgAssetHeaderMetadata({ ...view, revision: selected }).otherApprovedCurrent).toBeNull();
    expect(mktgAssetHeaderMetadata({ ...view, revision: { ...selected, latest: false } }).approval).toEqual(selected.approval);
  });

  it('leaves standalone attribution/version unknown instead of inventing metadata', () => {
    const view = headerView();
    expect(mktgAssetHeaderFallback(view.type.agentKey, null, null, null)).toEqual({
      version: null,
      createdAt: null,
      approval: null,
      agentName: view.type.agentName,
      otherApprovedCurrent: null,
    });
  });

  it('maps host states without promoting pending to approved', () => {
    expect(MKTG_HOST_ASSET_STATES).toEqual({
      none: null,
      queued: 'generating',
      drafting: 'generating',
      review: 'draft',
      pending: 'draft',
      approved: 'approved',
    });
  });
});
