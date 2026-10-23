// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOILERPLATES_LENGTHS, BRAND_KIT_CONTRACT_ID, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import type { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { ASSET_PROJECT, assetRevision } from './mktg-os-assets.helper';
import { suppressCookieBanner } from './account-settings-email.helper';
import type { Page } from '@playwright/test';

/** Shared synthetic stored-asset fixture for content and structural checks. */
export async function structuredCommentAsset(page: Page, agentKey: 'brand-kit' | 'boilerplates') {
  await suppressCookieBanner(page);
  const type = MKTG_DOCUMENT_TYPES.find((row) => row.agentKey === agentKey);
  if (!type) throw new Error('Missing registered synthetic document type');
  const kit = brandKitTestRevision();
  const base: MktgRevisionResponse = {
    ...assetRevision(),
    type,
    markdown:
      agentKey === 'brand-kit'
        ? '# Synthetic brand kit'
        : JSON.stringify({ bp: BOILERPLATES_LENGTHS.map((row) => ({ ...row, t: 'Synthetic open toolkit.' })) }),
    sidecar:
      agentKey === 'brand-kit'
        ? {
            contract: BRAND_KIT_CONTRACT_ID,
            project_name: kit.projectName,
            project: ASSET_PROJECT.uid,
            version: 1,
            mode: 'draft',
            kit: kit.kit,
            chapters: kit.chapters,
            report: kit.report,
          }
        : { report: kit.report, checks: { word_counts: [3, 3, 3, 3], findings: [] }, mode: 'draft' },
  };
  base.revision = {
    ...base.revision,
    draftVersion: 1,
    format: agentKey === 'brand-kit' ? 'markdown' : 'json',
    approval: { approvedAt: '2026-10-21T10:00:00Z', approvedBy: { name: 'Project writer' } },
  };
  return { base, kit, key: agentKey === 'brand-kit' ? 'chapters.voice.line' : 'bp[1].t' };
}
