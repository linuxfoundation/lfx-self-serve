// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Required output fields mirror agents/member-360/src/envelope.ts at marketing-os-agents 45734bc6.
// Additive envelope/input/row keys are stripped for 2.0 compatibility; required fields
// and rendering constraints remain validated. Hash verification belongs to the BFF.
import { z } from 'zod';
import {
  CATEGORY_KEYS,
  ENGAGEMENT_TIERS,
  ACTION_OWNERS,
  PRIORITIES,
  DATA_SOURCES,
  SCOPE_WARNINGS,
  MEMBER_360_CONTRACT_ID,
} from '../constants/member-360.constants';
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const score100 = z.number().min(0).max(100);
const categoryKey = z.enum(CATEGORY_KEYS);
const engagementTier = z.enum(ENGAGEMENT_TIERS);
const actionOwner = z.enum(ACTION_OWNERS);
const priority = z.enum(PRIORITIES);
const routingRule = z.number().int().min(1).max(10);
const quarterLabel = z.string().regex(/^\d{4}-Q[1-4]$/);

export const weightsSchema = z
  .object({
    committees: z.number().min(0).max(100),
    events: z.number().min(0).max(100),
    speaking: z.number().min(0).max(100),
    content: z.number().min(0).max(100),
    community_programs: z.number().min(0).max(100),
    marketing_social: z.number().min(0).max(100),
  })
  .strict();

const noDataCategorySchema = z.object({ category: categoryKey, reason: z.string().min(1) }).strip();

const categoryResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('scored'),
      raw_count: z.number().int().min(0),
      recency_weighted_count: z.number().min(0),
      tier_peer_median: z.number().min(0),
      score: score100,
    })
    .strip(),
  z.object({ status: z.literal('no_data') }).strip(),
]);

export const memberRankingRowSchema = z
  .object({
    rank: z.number().int().min(1),
    member_organization: z.string().min(1),
    membership_tier: z.string().min(1),
    annual_value: z.number().min(0).nullable(),
    renewal_date: isoDay.nullable(),
    days_to_renewal: z.number().int().nullable(),
    engagement_score: score100,
    engagement_tier: engagementTier,
    trend: z.enum(['▲', '▼', '—']).nullable(),
    committees_score: score100.nullable(),
    events_score: score100.nullable(),
    speaking_score: score100.nullable(),
    content_score: score100.nullable(),
    community_programs_score: score100.nullable(),
    marketing_social_score: score100.nullable(),
    last_meaningful_engagement: z.string().min(1).nullable(),
    engaged_contacts: z.number().int().min(0),
    key_contact: z.string().min(1).nullable(),
    top_gaps: z.array(z.string().min(1)).max(3),
    recommended_next_action: z.string().min(1),
    action_owner: actionOwner,
    priority,
  })
  .strip();

const windowSchema = z.object({ start: isoDay, end: isoDay }).strict();

export const summaryTabSchema = z
  .object({
    project_name: z.string().min(1),
    analysis_window: windowSchema,
    run_date: isoDay,
    member_count: z.number().int().min(1),
    total_membership_value: z.number().min(0),
    tier_distribution: z
      .object({
        Champion: z.number().int().min(0),
        Engaged: z.number().int().min(0),
        Passive: z.number().int().min(0),
        'At Risk': z.number().int().min(0),
        Dormant: z.number().int().min(0),
      })
      .strict(),
    movers: z
      .object({
        gainers: z.array(z.object({ member_organization: z.string().min(1), delta: z.number() }).strip()).max(3),
        decliners: z.array(z.object({ member_organization: z.string().min(1), delta: z.number() }).strip()).max(3),
      })
      .strict()
      .nullable(),
    watchlist: z.array(
      z
        .object({
          member_organization: z.string().min(1),
          days_to_renewal: z.number().int(),
          engagement_score: score100,
          engagement_tier: engagementTier,
        })
        .strip()
    ),
    action_load: z.array(z.object({ owner: actionOwner, actions: z.number().int().min(0), high_priority: z.number().int().min(0) }).strip()).length(3),
    data_coverage: z.object({ sources_used: z.array(z.string().min(1)), sources_unavailable: z.array(z.string().min(1)) }).strict(),
  })
  .strict();

export const categoryDetailRowSchema = z
  .object({
    member_organization: z.string().min(1),
    categories: z
      .object({
        committees: categoryResultSchema,
        events: categoryResultSchema,
        speaking: categoryResultSchema,
        content: categoryResultSchema,
        community_programs: categoryResultSchema,
        marketing_social: categoryResultSchema,
      })
      .strict(),
  })
  .strip();

export const actionsByTeamRowSchema = z
  .object({
    owner: actionOwner,
    priority,
    member_organization: z.string().min(1),
    engagement_tier: engagementTier,
    days_to_renewal: z.number().int().nullable(),
    recommended_action: z.string().min(1),
    supporting_rationale: z.string().min(1),
    suggested_deadline: z.string().min(1).nullable(),
    routing_rule: routingRule,
  })
  .strip();

export const evidenceRowSchema = z
  .object({
    member_organization: z.string().min(1),
    category: categoryKey,
    date: isoDay,
    description: z.string().min(1),
    source: z.string().min(1),
    signal_weight: z.number().min(1).max(3),
  })
  .strip();

export const methodTabSchema = z
  .object({
    analysis_window: windowSchema,
    focus_quarter: quarterLabel,
    run_date: isoDay,
    weights_default: weightsSchema,
    weights_used: weightsSchema,
    reweighted: z.boolean(),
    categories_no_data: z.array(noDataCategorySchema).max(5),
    quarter_decay: z.array(z.object({ quarter: quarterLabel, factor: z.number().min(0).max(1) }).strip()).length(4),
    tier_baselines: z
      .array(
        z
          .object({
            baseline_group: z.string().min(1),
            tiers: z.array(z.string().min(1)).min(1),
            member_count: z.number().int().min(1),
            merged: z.boolean(),
            medians: z
              .object({
                committees: z.number().min(0).optional(),
                events: z.number().min(0).optional(),
                speaking: z.number().min(0).optional(),
                content: z.number().min(0).optional(),
                community_programs: z.number().min(0).optional(),
                marketing_social: z.number().min(0).optional(),
              })
              .strict(),
          })
          .strip()
      )
      .min(1),
    routing_rule_version: z.string().min(1),
    data_sources: z
      .array(
        z
          .object({
            source: z.enum(DATA_SOURCES),
            label: z.string().min(1),
            status: z.enum(['used', 'unavailable', 'not_wired']),
            note: z.string().min(1).optional(),
          })
          .strip()
      )
      .length(DATA_SOURCES.length),
    overrides: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export const tabsSchema = z
  .object({
    summary: summaryTabSchema,
    member_ranking: z.array(memberRankingRowSchema).min(1),
    category_detail: z.array(categoryDetailRowSchema).min(1),
    actions_by_team: z.array(actionsByTeamRowSchema).min(1),
    evidence: z.array(evidenceRowSchema),
    method: methodTabSchema,
  })
  .strict();

export const envelopeSchema = z
  .object({
    contract: z.literal(MEMBER_360_CONTRACT_ID),
    kind: z.literal('member-360'),
    project: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
    project_name: z.string().min(1),
    lfx_project_name: z.string().min(1).optional(),
    project_uid: z.string().min(1).optional(),
    project_slug: z.string().min(1).optional(),
    version: z.number().int().min(1),
    period: z
      .object({
        window_start: isoDay,
        window_end: isoDay,
        focus_quarter: quarterLabel,
        label: quarterLabel,
      })
      .strict(),
    run_date: isoDay,
    summary_markdown: z.string().min(80),
    tabs: tabsSchema,
    content_sha256: sha256,
    warnings: z.array(z.enum(SCOPE_WARNINGS)),
    inputs: z
      .object({
        trackers_provided: z.boolean(),
        trackers_count: z.number().int().min(1).optional(),
        prior_run_provided: z.boolean(),
        weight_overrides_provided: z.boolean(),
      })
      .strip(),
    intake: z.object({ completed_at: z.iso.datetime(), mode: z.literal('form') }).strict(),
    generated_at: z.iso.datetime(),
    agent: z
      .object({
        identifier: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*~[a-z0-9][a-z0-9-]*$/)
          .optional(),
        agent_version: z.string().regex(/^\d+\.\d+\.\d+$/),
        prompt_manifest_sha256: sha256,
      })
      .strict(),
  })
  .strip();
