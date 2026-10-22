// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_FAMILY_EXPORT_SCHEMA } from '../constants/mktg-family-export.constants';
import type { MktgFamilyExportMember, MktgFamilyExportRecord, MktgFamilyExportSnapshot } from '../interfaces/mktg-family-export.interface';
import {
  buildMktgFamilyExportPrefix,
  buildMktgFamilyExportRecordKey,
  isMktgFamilyExportMembers,
  isMktgFamilyExportStale,
  mktgFamilyExportAgentKeys,
  mktgFamilyExportBinding,
  readMktgFamilyExportRecord,
  readMktgFamilyExportSnapshot,
  readMktgFamilyExportTarget,
} from './mktg-family-export.utils';
import { buildMktgSlidesExportRecordKey } from './mktg-slides-export.utils';

function member(overrides: Partial<MktgFamilyExportMember> = {}): MktgFamilyExportMember {
  return {
    agentKey: 'foundation-message',
    documentId: 'living',
    revisionId: `000001-${'a'.repeat(64)}`,
    revisionNumber: 1,
    contentSha256: 'b'.repeat(64),
    ...overrides,
  };
}
function record(overrides: Partial<MktgFamilyExportRecord> = {}): MktgFamilyExportRecord {
  return {
    schema: MKTG_FAMILY_EXPORT_SCHEMA,
    project: 'synthetic-project',
    familyId: 'positioning-brand',
    members: [member()],
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
function snapshot(overrides: Partial<MktgFamilyExportSnapshot> = {}): MktgFamilyExportSnapshot {
  return { project: 'synthetic-project', familyId: 'positioning-brand', members: [member()], mode: 'create', deckId: null, ...overrides };
}

describe('Family export contract', () => {
  it('derives catalog membership in exporter order, without offering unsupported families', () => {
    expect(mktgFamilyExportAgentKeys('positioning-brand')).toEqual(['foundation-message', 'brand-kit', 'boilerplates', 'faq']);
    expect(mktgFamilyExportAgentKeys('website-web')).toEqual([]);
    expect(mktgFamilyExportAgentKeys('../unknown')).toEqual([]);
    expect(readMktgFamilyExportTarget(snapshot())).toEqual({ project: 'synthetic-project', familyId: 'positioning-brand' });
    expect(readMktgFamilyExportTarget(snapshot({ project: '../escape' }))).toBeNull();
  });

  it('isolates family keys from document exports', () => {
    expect(buildMktgFamilyExportPrefix('synthetic-project', 'positioning-brand')).toBe('slides-exports/synthetic-project/families/positioning-brand/');
  });

  it('shares document time formatting while keeping family keys isolated', () => {
    const sha = 'a'.repeat(64);
    for (const time of [0, -1, 1234.9, 1792458000000]) {
      const familyKey = buildMktgFamilyExportRecordKey('synthetic-project', 'positioning-brand', time, sha);
      const documentKey = buildMktgSlidesExportRecordKey('synthetic-project', 'foundation-message', 'living', time, sha);
      expect(familyKey.split('/').at(-1)).toBe(documentKey.split('/').at(-1));
      expect(familyKey).toMatch(new RegExp(`/[0-9]{15}-${sha}\\.json$`));
    }
  });

  it('rejects duplicate, foreign, unpersisted or malformed member references', () => {
    expect(isMktgFamilyExportMembers([], 'positioning-brand')).toBe(false);
    for (const members of [
      [member(), member()],
      [member({ documentId: '../escape' })],
      [member({ revisionId: `legacy-${'a'.repeat(64)}` })],
      [member({ revisionNumber: 0 })],
      [member({ contentSha256: 'not-a-hash' })],
      [{ ...member(), agentKey: 'aeo-geo' }],
    ]) {
      expect(isMktgFamilyExportMembers(members, 'positioning-brand')).toBe(false);
    }
    expect(isMktgFamilyExportMembers([member()], 'website-web')).toBe(false);
  });

  it('compares exact approved identities, including removal and newly approved members', () => {
    expect(isMktgFamilyExportStale(null, [member()])).toBe(false);
    expect(isMktgFamilyExportStale(record(), [member()])).toBe(false);
    expect(isMktgFamilyExportStale(record(), [])).toBe(true);
    expect(isMktgFamilyExportStale(record(), [member(), member({ agentKey: 'faq' })])).toBe(true);
    expect(isMktgFamilyExportStale(record(), [member({ revisionId: `000002-${'c'.repeat(64)}`, revisionNumber: 2 })])).toBe(true);
    const members = [member(), member({ agentKey: 'brand-kit' })];
    expect(isMktgFamilyExportStale(record({ members }), [...members].reverse())).toBe(false);
  });

  it('validates stored records including deck link, schema, members and date', () => {
    expect(readMktgFamilyExportRecord(record())).toEqual(record());
    for (const invalid of [
      null,
      {},
      record({ schema: 'document-export' }),
      record({ link: 'https://malicious.example/' }),
      record({ members: [] }),
      record({ exportedAt: '2026-99-99T00:00:00Z' }),
      record({ assets: [] }),
    ]) {
      expect(readMktgFamilyExportRecord(invalid)).toBeNull();
    }
  });

  it('requires update deck ids and forbids client-specified create deck ids', () => {
    expect(readMktgFamilyExportSnapshot(snapshot())).toEqual(snapshot());
    expect(readMktgFamilyExportSnapshot(snapshot({ mode: 'update' }))).toBeNull();
    expect(readMktgFamilyExportSnapshot(snapshot({ deckId: 'synthetic_deck_123' }))).toBeNull();
    expect(readMktgFamilyExportSnapshot(snapshot({ mode: 'update', deckId: 'synthetic_deck_123' }))).not.toBeNull();
    const raw = { ...snapshot(), members: [{ ...member(), ignored: 'not persisted' }] };
    expect(readMktgFamilyExportSnapshot(raw)?.members).toEqual([member()]);
  });

  it('binds session, project, family, mode, deck and every revision; ignores ordering only', () => {
    const original = snapshot({ members: [member(), member({ agentKey: 'faq' })] });
    const binding = mktgFamilyExportBinding('synthetic-session', original);
    expect(mktgFamilyExportBinding('synthetic-session', { ...original, members: [...original.members].reverse() })).toBe(binding);
    for (const changed of [
      snapshot({ project: 'other-project' }),
      snapshot({ familyId: 'other-family' }),
      snapshot({ mode: 'update', deckId: 'synthetic_deck_123' }),
      snapshot({ members: [member({ revisionNumber: 3 })] }),
    ]) {
      expect(mktgFamilyExportBinding('synthetic-session', changed)).not.toBe(binding);
    }
    expect(mktgFamilyExportBinding('other-session', original)).not.toBe(binding);
  });
});
