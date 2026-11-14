// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '../constants/mktg-artifact.constants';
import { MKTG_LIVING_DOCUMENT_ID, MKTG_REVISION_ID_REGEX } from '../constants/mktg-document-store.constants';
import { MKTG_FAMILY_EXPORT_KINDS, MKTG_FAMILY_EXPORT_SCHEMA } from '../constants/mktg-family-export.constants';
import { MKTG_KIT_FAMILIES } from '../constants/mktg-kit.constants';
import {
  MKTG_SLIDES_EXPORT_ASSET_KINDS,
  MKTG_SLIDES_EXPORT_KEY_PREFIX,
  MKTG_SLIDES_EXPORT_MODES,
  MKTG_SLIDES_EXPORT_SHA256_REGEX,
} from '../constants/mktg-slides-export.constants';
import type {
  MktgFamilyExportAgentKey,
  MktgFamilyExportMember,
  MktgFamilyExportRecord,
  MktgFamilyExportSnapshot,
  MktgFamilyExportTarget,
} from '../interfaces/mktg-family-export.interface';
import { buildMktgSlidesExportTimedRecordKey, isMktgSlidesExportDeckRecord, isMktgSlidesExportDriveId } from './mktg-slides-export.utils';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMktgFamilyExportAgentKey(value: unknown): value is MktgFamilyExportAgentKey {
  return typeof value === 'string' && Object.hasOwn(MKTG_FAMILY_EXPORT_KINDS, value);
}

/** Membership comes from the kit catalog; presentation order comes from the exporter contract. */
export function mktgFamilyExportAgentKeys(familyId: string): MktgFamilyExportAgentKey[] {
  const family = MKTG_KIT_FAMILIES.find((entry) => entry.id === familyId);
  return (family?.assets.map((asset) => asset.agentKey).filter(isMktgFamilyExportAgentKey) ?? []).sort(
    (a, b) => MKTG_SLIDES_EXPORT_ASSET_KINDS.indexOf(MKTG_FAMILY_EXPORT_KINDS[a]) - MKTG_SLIDES_EXPORT_ASSET_KINDS.indexOf(MKTG_FAMILY_EXPORT_KINDS[b])
  );
}

export function readMktgFamilyExportTarget(value: unknown): MktgFamilyExportTarget | null {
  if (
    !isRecord(value) ||
    typeof value['project'] !== 'string' ||
    !MKTG_ARTIFACT_PARTITION_REGEX.test(value['project']) ||
    typeof value['familyId'] !== 'string'
  )
    return null;
  return mktgFamilyExportAgentKeys(value['familyId']).length ? { project: value['project'], familyId: value['familyId'] } : null;
}

/** Reject duplicates, foreign members, legacy revisions and unsafe path segments. */
export function isMktgFamilyExportMembers(value: unknown, familyId: string): value is MktgFamilyExportMember[] {
  const keys = mktgFamilyExportAgentKeys(familyId);
  if (!Array.isArray(value) || value.length === 0 || value.length > keys.length) return false;
  const seen = new Set<string>();
  return value.every((member) => {
    if (!isRecord(member) || !isMktgFamilyExportAgentKey(member['agentKey']) || !keys.includes(member['agentKey']) || seen.has(member['agentKey']))
      return false;
    seen.add(member['agentKey']);
    return (
      member['documentId'] === MKTG_LIVING_DOCUMENT_ID &&
      typeof member['revisionId'] === 'string' &&
      !member['revisionId'].startsWith('legacy-') &&
      MKTG_REVISION_ID_REGEX.test(member['revisionId']) &&
      Number.isInteger(member['revisionNumber']) &&
      Number(member['revisionNumber']) > 0 &&
      typeof member['contentSha256'] === 'string' &&
      MKTG_SLIDES_EXPORT_SHA256_REGEX.test(member['contentSha256'])
    );
  });
}

/** Stable regardless of object property order or input member ordering. */
export function mktgFamilyExportMemberIdentity(members: MktgFamilyExportMember[]): string {
  return JSON.stringify(
    [...members]
      .sort((a, b) => a.agentKey.localeCompare(b.agentKey))
      .map((member) => [member.agentKey, member.documentId, member.revisionId, member.revisionNumber, member.contentSha256])
  );
}

export function isMktgFamilyExportStale(last: MktgFamilyExportRecord | null, current: MktgFamilyExportMember[]): boolean {
  return last !== null && mktgFamilyExportMemberIdentity(last.members) !== mktgFamilyExportMemberIdentity(current);
}

export function readMktgFamilyExportSnapshot(value: unknown): MktgFamilyExportSnapshot | null {
  const target = readMktgFamilyExportTarget(value);
  if (
    !target ||
    !isRecord(value) ||
    !isMktgFamilyExportMembers(value['members'], target.familyId) ||
    !(MKTG_SLIDES_EXPORT_MODES as readonly unknown[]).includes(value['mode'])
  )
    return null;
  if (value['mode'] === 'update' ? !isMktgSlidesExportDriveId(value['deckId']) : value['deckId'] !== null) return null;
  const members = value['members'].map(({ agentKey, documentId, revisionId, revisionNumber, contentSha256 }) => ({
    agentKey,
    documentId,
    revisionId,
    revisionNumber,
    contentSha256,
  }));
  return { ...target, members, mode: value['mode'] as MktgFamilyExportSnapshot['mode'], deckId: value['deckId'] as string | null };
}

/** Owner token binding contains the full server-selected export context. */
export function mktgFamilyExportBinding(sessionId: string, snapshot: MktgFamilyExportSnapshot): string {
  return JSON.stringify([
    'family-slides-export',
    sessionId,
    snapshot.project,
    snapshot.familyId,
    snapshot.mode,
    snapshot.deckId,
    mktgFamilyExportMemberIdentity(snapshot.members),
  ]);
}

export function buildMktgFamilyExportPrefix(project: string, familyId: string): string {
  return `${MKTG_SLIDES_EXPORT_KEY_PREFIX}/${project}/families/${familyId}/`;
}

/** Family-scoped key with the same time/hash suffix as a document export. */
export function buildMktgFamilyExportRecordKey(project: string, familyId: string, exportedAtMs: number, sha: string): string {
  return buildMktgSlidesExportTimedRecordKey(buildMktgFamilyExportPrefix(project, familyId), exportedAtMs, sha);
}

export function readMktgFamilyExportRecord(value: unknown): MktgFamilyExportRecord | null {
  if (
    !isRecord(value) ||
    value['schema'] !== MKTG_FAMILY_EXPORT_SCHEMA ||
    !readMktgFamilyExportTarget(value) ||
    typeof value['familyId'] !== 'string' ||
    !isMktgFamilyExportMembers(value['members'], value['familyId']) ||
    !isMktgSlidesExportDeckRecord(value) ||
    !Number.isFinite(Date.parse(value['exportedAt'])) ||
    value['assets'].length === 0 ||
    !value['assets'].every((asset) => (MKTG_SLIDES_EXPORT_ASSET_KINDS as readonly unknown[]).includes(asset))
  )
    return null;
  return { ...value, familyId: value['familyId'], members: value['members'] };
}
