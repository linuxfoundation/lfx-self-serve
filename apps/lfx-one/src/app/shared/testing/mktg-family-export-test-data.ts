// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_FAMILY_EXPORT_SCHEMA } from '@lfx-one/shared/constants';
import { MktgFamilyExportMember, MktgFamilyExportRecord, MktgFamilyExportStartResponse } from '@lfx-one/shared/interfaces';

/** Synthetic export fixtures shared by unit tests and stubbed Family-page e2e. */
export function familyExportMember(overrides: Partial<MktgFamilyExportMember> = {}): MktgFamilyExportMember {
  return {
    agentKey: 'foundation-message',
    documentId: 'living',
    revisionId: `000001-${'a'.repeat(64)}`,
    revisionNumber: 1,
    contentSha256: 'b'.repeat(64),
    ...overrides,
  };
}

export function familyExportRecord(overrides: Partial<MktgFamilyExportRecord> = {}): MktgFamilyExportRecord {
  return {
    schema: MKTG_FAMILY_EXPORT_SCHEMA,
    project: 'synthetic-project',
    familyId: 'positioning-brand',
    members: [familyExportMember()],
    mode: 'create',
    deckId: 'synthetic_deck_123',
    link: 'https://docs.google.com/presentation/d/synthetic_deck_123/edit',
    title: 'Synthetic family',
    slideCount: 2,
    assets: ['framework'],
    branded: { kit: false, logo: false, backgrounds: 0, text_colors: 0, fonts: 0, bars: 0, logos: 0, logos_skipped: 0, tables_header: null },
    exportedAt: '2026-10-20T01:00:00.000Z',
    agentVersion: '1.1.1',
    ...overrides,
  };
}

export function familyExportStarted(project = 'synthetic-project'): MktgFamilyExportStartResponse {
  return {
    sessionId: 'synthetic-session',
    ownerToken: 'synthetic-token',
    logoNote: 'no-logo',
    skippedMembers: ['brand-kit', 'boilerplates', 'faq'],
    snapshot: { project, familyId: 'positioning-brand', mode: 'create', deckId: null, members: [familyExportMember()] },
  };
}
