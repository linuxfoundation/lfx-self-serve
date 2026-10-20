// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_HOST_ASSET_STATES } from '../constants/mktg-asset.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import type { MktgRevisionResponse, MktgRevisionSummary } from '../interfaces/mktg-document-store.interface';
import { mktgAssetHeaderFallback, mktgAssetHeaderMetadata } from './mktg-asset.utils';

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
