// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_CONTACT_PLACEHOLDERS } from '../constants/member-360.constants';
import type { Member360Tabs } from '../interfaces/member-360.interface';

/** Exact known contacts only, never guessed names or fragments inside other words. */
export function createMember360Redactor(contacts: (string | null)[]): (text: string) => string {
  const patterns = [...new Set(contacts.filter((value): value is string => value !== null).map((value) => value.trim()))]
    .filter((value) => value.length >= 3 && !MEMBER_360_CONTACT_PLACEHOLDERS.some((placeholder) => placeholder === value.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .map((value) => new RegExp(`(?<![\\p{L}\\p{N}_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'gu'));
  return (text) =>
    patterns
      .reduce((value, pattern) => value.replace(pattern, '[contact redacted]'), text)
      .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, '[contact redacted]');
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
