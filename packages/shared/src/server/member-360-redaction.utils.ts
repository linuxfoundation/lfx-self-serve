// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_CONTACT_PLACEHOLDERS } from '../constants/member-360.constants';
import type { Member360Tabs } from '../interfaces/member-360.interface';

/** Privacy extraction is structural, independent of schema validity and project scope. */
export function member360CandidateContacts(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== 'object' || !('tabs' in candidate)) return [];
  const tabs = candidate.tabs;
  if (!tabs || typeof tabs !== 'object' || !('member_ranking' in tabs) || !Array.isArray(tabs.member_ranking)) return [];
  return tabs.member_ranking.flatMap((row: unknown) =>
    row && typeof row === 'object' && 'key_contact' in row && typeof row.key_contact === 'string' ? [row.key_contact] : []
  );
}

/** Scan each side of @ once; never retry a local-part regex at every character. */
function markEmailSpans(text: string, ends: Uint32Array): void {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at;
    while (start > 0 && /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]/i.test(text[start - 1])) start--;
    let end = at + 1;
    let labels = 0;
    let validEnd = end;
    while (end < text.length) {
      const labelStart = end;
      while (end < text.length && /[A-Z0-9-]/i.test(text[end])) end++;
      if (end === labelStart) break;
      labels++;
      if (labels > 1) validEnd = end;
      if (text[end] !== '.') break;
      end++;
    }
    if (start === at || labels < 2) continue;
    ends[start] = Math.max(ends[start], validEnd);
  }
}

/** Exact known contacts only, never guessed names or fragments inside other words. */
export function createMember360Redactor(contacts: (string | null)[], subjects?: RegExp): (text: string) => string {
  const patterns = [...new Set(contacts.filter((value): value is string => value !== null).map((value) => value.trim()))]
    .filter((value) => value.length >= 3 && !MEMBER_360_CONTACT_PLACEHOLDERS.some((placeholder) => placeholder === value.toLowerCase()))
    .map((value) => new RegExp(`(?<![\\p{L}\\p{N}_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu'));
  return (text) => {
    // Both detectors see original bytes. Index by start to union spans in linear time,
    // without sorting or allowing one replacement to hide another contact/email.
    const ends = new Uint32Array(text.length);
    markEmailSpans(text, ends);
    // Match contacts first, then optional provider subjects, all against original
    // bytes. Unioning spans prevents either replacement from hiding the other.
    for (const pattern of [...patterns, ...(subjects ? [subjects] : [])]) {
      for (const match of text.matchAll(pattern)) ends[match.index] = Math.max(ends[match.index], match.index + match[0].length);
    }
    const chunks: string[] = [];
    let copied = 0;
    let end = 0;
    for (let start = 0; start < text.length; start++) {
      if (ends[start] <= start) continue;
      if (start >= end) {
        chunks.push(text.slice(copied, start), '[contact redacted]');
      }
      end = Math.max(end, ends[start]);
      copied = end;
    }
    return chunks.join('') + text.slice(copied);
  };
}

/** Walk only the contract's known free-text fields; leave dates, enums and scores intact. */
export function redactMember360Tabs(tabs: Member360Tabs, redact: (text: string) => string): Member360Tabs {
  const redactIdentity = createMember360Redactor([]);
  const member = <T extends { member_organization: string }>(row: T): T => ({ ...row, member_organization: redactIdentity(row.member_organization) });
  const nullable = (text: string | null): string | null => (text === null ? null : redact(text));
  return {
    ...tabs,
    summary: {
      ...tabs.summary,
      project_name: redactIdentity(tabs.summary.project_name),
      movers: tabs.summary.movers && { gainers: tabs.summary.movers.gainers.map(member), decliners: tabs.summary.movers.decliners.map(member) },
      watchlist: tabs.summary.watchlist.map(member),
      data_coverage: {
        sources_used: tabs.summary.data_coverage.sources_used.map(redact),
        sources_unavailable: tabs.summary.data_coverage.sources_unavailable.map(redact),
      },
    },
    member_ranking: tabs.member_ranking.map((row) => ({
      ...member(row),
      membership_tier: redact(row.membership_tier),
      last_meaningful_engagement: nullable(row.last_meaningful_engagement),
      recommended_next_action: redact(row.recommended_next_action),
      key_contact: null,
      top_gaps: row.top_gaps.map(redact),
    })),
    category_detail: tabs.category_detail.map(member),
    actions_by_team: tabs.actions_by_team.map((row) => ({
      ...member(row),
      recommended_action: redact(row.recommended_action),
      supporting_rationale: redact(row.supporting_rationale),
      suggested_deadline: nullable(row.suggested_deadline),
    })),
    evidence: tabs.evidence.map((row) => ({ ...member(row), description: redact(row.description), source: redact(row.source) })),
    method: {
      ...tabs.method,
      routing_rule_version: redact(tabs.method.routing_rule_version),
      categories_no_data: tabs.method.categories_no_data.map((row) => ({ ...row, reason: redact(row.reason) })),
      tier_baselines: tabs.method.tier_baselines.map((row) => ({ ...row, baseline_group: redact(row.baseline_group), tiers: row.tiers.map(redact) })),
      data_sources: tabs.method.data_sources.map((row) => ({ ...row, label: redact(row.label), note: row.note === undefined ? undefined : redact(row.note) })),
      notes: tabs.method.notes.map(redact),
      overrides: tabs.method.overrides.map(redact),
    },
  };
}
