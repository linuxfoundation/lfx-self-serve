// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatInTimeZone } from 'date-fns-tz';
import { enGB } from 'date-fns/locale';
import type { FoundationMessageReport } from '../interfaces/foundation-message.interface';
import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_REVISION_ID_REGEX } from '../constants/mktg-document-store.constants';
import {
  MKTG_KIT_FAMILIES,
  MKTG_KIT_POSITIONING_FAMILY_ID,
  MKTG_KIT_STATE_LABELS,
  MKTG_KIT_EXCLUDED_DOCUMENT_KEYS,
  MKTG_KIT_EXCLUDED_AGENT_IDS,
} from '../constants/mktg-kit.constants';
import type { MktgDocumentListItem, MktgDocumentsResponse } from '../interfaces/mktg-document-store.interface';
import type { MktgKitAsset, MktgKitAssetRow, MktgKitFamily, MktgKitFamilyView, MktgKitSummary, MktgKitSourcesView } from '../interfaces/mktg-kit.interface';

import { isMktgFamilyAgentAvailable } from './mktg-family-actions.utils';

/** The Kit catalogue owns common asset display labels. */
export function mktgKitAssetLabel(agentKey: string): string | undefined {
  return MKTG_KIT_FAMILIES.flatMap((family) => family.assets).find((asset) => asset.agentKey === agentKey)?.label;
}

/** Stable UTC day/month for one-off history; invalid or absent timestamps remain unknown. */
export function mktgKitRunDate(createdAt: string | null | undefined): string {
  const date = new Date(createdAt ?? '');
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, 'UTC', 'd MMM', { locale: enGB }) : '—';
}

/** Render workflow states independently of their provenance (including future producer states). */
export function describeMktgKitAsset(row: Pick<MktgKitAssetRow, 'state' | 'version' | 'monthlyCount'> & Partial<Pick<MktgKitAssetRow, 'document'>>): string {
  if (row.state === 'coming-soon') return MKTG_KIT_STATE_LABELS['coming-soon'];
  if (row.monthlyCount !== null) {
    if (row.monthlyCount > 0) return `${row.monthlyCount} this month`;
    return row.document ? `Last run ${mktgKitRunDate(row.document.createdAt)}` : MKTG_KIT_STATE_LABELS.missing;
  }
  if (!row.state) return '';
  const label = MKTG_KIT_STATE_LABELS[row.state];
  return row.state === 'approved' && row.version !== null ? `${label} · v${row.version}` : label;
}

/**
 * approvedCurrent identifies an approved revision by revisionId/number.
 * Only valid approval metadata yields Approved; absent or malformed metadata retains Draft.
 * A current pointer or revisionCount never implies approval. updatedAt remains the listing's
 * only date. Needs rebuild uses the server's current-revision provenance projection;
 * one-off runs never go stale, and timestamps alone never establish staleness.
 */
export function resolveMktgKitLivingState(document: MktgDocumentListItem | null): Pick<MktgKitAssetRow, 'state' | 'version'> {
  if (!document) return { state: 'missing', version: null };
  if (document.needsRebuild) return { state: 'needs-rebuild', version: mktgKitCurrentVersion(document) };
  const approved = document.approvedCurrent;
  if (
    approved &&
    Number.isSafeInteger(approved.number) &&
    approved.number > 0 &&
    typeof approved.revisionId === 'string' &&
    approved.revisionId.trim().length > 0
  )
    return { state: 'approved', version: approved.number };
  return { state: 'draft', version: mktgKitCurrentVersion(document) };
}

/**
 * Join assets to the base listing. updatedAt supplies the Current date;
 * createdAt supplies calendar-month run counts. Unregistered assets are
 * coming-soon. Approval integration is isolated in resolveMktgKitLivingState.
 */
export function resolveMktgKitAsset(asset: MktgKitAsset, listing: MktgDocumentsResponse, now = new Date()): MktgKitAssetRow {
  const type = kitDocumentType(asset);
  const documents = listing.groups.find((group) => group.type.agentKey === asset.agentKey)?.documents ?? [];
  const document = documents[0] ?? null;
  const row: MktgKitAssetRow = {
    asset,
    document,
    madeBy: type?.agentName ?? '—',
    state: type ? 'missing' : 'coming-soon',
    version: null,
    monthlyCount: null,
    badge: '',
  };
  if (!type?.catalogAgentId || !isMktgFamilyAgentAvailable(type.catalogAgentId)) {
    row.state = 'coming-soon';
  } else if (type.kind === 'run') {
    // Listing order is not a createdAt guarantee: select the newest run without mutating it.
    row.document = documents.reduce<MktgDocumentListItem | null>((latest, entry) => {
      const created = Date.parse(entry.createdAt ?? '');
      const previous = Date.parse(latest?.createdAt ?? '');
      return !latest || (Number.isFinite(created) && (!Number.isFinite(previous) || created > previous)) ? entry : latest;
    }, null);
    row.state = row.document ? null : 'missing';
    row.monthlyCount = documents.filter((entry) => {
      if (!entry.createdAt) return false;
      const date = new Date(entry.createdAt);
      return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
    }).length;
  } else {
    const living = resolveMktgKitLivingState(document);
    row.state = living.state;
    row.version = living.version;
  }
  row.badge = describeMktgKitAsset(row);
  return row;
}

/** A family is live only when at least one asset has a registered document-store type. */
export function isMktgKitFamilyLive(family: MktgKitFamily): boolean {
  return family.assets.some((asset) => !!kitDocumentType(asset));
}

export function resolveMktgKit(listing: MktgDocumentsResponse, now = new Date()): MktgKitFamilyView[] {
  return MKTG_KIT_FAMILIES.map((family) => ({
    family,
    live: isMktgKitFamilyLive(family),
    rows: family.assets
      .filter((asset) => !asset.agentKey || !MKTG_KIT_EXCLUDED_DOCUMENT_KEYS.includes(asset.agentKey))
      .map((asset) => resolveMktgKitAsset(asset, listing, now)),
    agents: family.agentIds.filter((id) => !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(id)).flatMap((id) => MKTG_AGENTS.filter((agent) => agent.id === id)),
  }));
}

/** Main board totals count approved assets only; the empty level is not an invented tier. */
export function summarizeMktgKit(families: MktgKitFamilyView[]): MktgKitSummary {
  const inKit = (row: MktgKitAssetRow): boolean => row.state === 'approved';
  const positioning = families.find((family) => family.family.id === MKTG_KIT_POSITIONING_FAMILY_ID)?.rows.filter((row) => row.state !== 'coming-soon') ?? [];
  return {
    level: positioning.length > 0 && positioning.every(inKit) ? 'Core' : null,
    coreFloor: families.filter((family) => family.rows.some(inKit)).length,
    inKit: families.flatMap((family) => family.rows).filter(inKit).length,
  };
}

/** Prefer the store's displayed current number; older listings fall back to the selected id's sequence. */
export function mktgKitCurrentVersion(document: MktgDocumentListItem): number | null {
  const current = document.currentRevisionNumber;
  if (typeof current === 'number' && Number.isSafeInteger(current) && current > 0) return current;
  if (!MKTG_REVISION_ID_REGEX.test(document.latestRevisionId) || document.latestRevisionId.startsWith('legacy-')) return null;
  const number = Number(document.latestRevisionId.split('-')[0]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Only the framework report's declared source fields are rendered; never expose arbitrary sidecar JSON. */
export function mktgKitSources(sidecar: Record<string, unknown> | null): MktgKitSourcesView | null {
  const report = sidecar?.['report'];
  if (!report || typeof report !== 'object' || !('sources_read' in report) || !('sources_failed' in report)) return null;
  const read = report.sources_read;
  const failed = report.sources_failed;
  if (!Array.isArray(read) || !read.every((source): source is string => typeof source === 'string') || !Array.isArray(failed) || !failed.every(isSourceFailure))
    return null;
  if (!read.length && !failed.length) return null;
  const sourceLabel = failed.length === 1 ? 'source' : 'sources';
  return {
    readCount: read.length,
    failedCount: failed.length,
    readText: read.length ? `Sources read on the last run: ${read.join(', ')}.` : '',
    failedText: failed.length ? `${failed.length} ${sourceLabel} failed: ${failed.map((source) => `${source.name}: ${source.reason}`).join('; ')}.` : '',
  };
}

function isSourceFailure(value: unknown): value is FoundationMessageReport['sources_failed'][number] {
  return !!value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' && 'reason' in value && typeof value.reason === 'string';
}

function kitDocumentType(asset: MktgKitAsset) {
  return MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === asset.agentKey && !MKTG_KIT_EXCLUDED_DOCUMENT_KEYS.includes(type.agentKey));
}
