// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { BADGE_FILTER_OPTIONS } from '../constants/badge.constants';
import { Badge, BadgeCategory } from '../interfaces/badge.interface';
import { CredlyBadgeEntry } from '../interfaces/credly.interface';

const CREDLY_EDIT_FRAGMENT = '/edit#credly';

const PROJECT_TAGS = new Set([
  'cncf',
  'risc-v',
  'lf networking',
  'openjs foundation',
  'pytorch',
  'hyperledger badges',
  'open mainframe project',
  'lf research',
  'finops foundation',
  'zephyr',
  'egeria',
  'presto',
  'academy software foundation',
  'opends4all',
  'lf europe',
  'cdf',
  'core events badges',
]);
const CERTIFICATION_REPORTING_TAGS = new Set(['certification', 'finops foundation certifications']);
const LEARNING_REPORTING_TAGS = new Set(['elearning', 'instructor-led training', 'express learning']);
const CONTRIBUTOR_REPORTING_TAGS = new Set(['project maintainer/contributer', 'exam developer badges', 'exam contributor', 'course developer']);
const SPEAKING_PATTERN = /speaker|keynote|panelist|presenter/;
const MEMBERSHIP_PATTERN = /^openjs foundation/;
const CONTRIBUTOR_PATTERN = /contributor|committer|maintainer|mentor|mentee|ambassador|evangelist|community leader|zero to merge/;
const PROGRAM_COMMITTEE_PATTERN = /program committee|co-chair|chair:|advisory|steering committee|\btsc\b|organizer/;
const ATTENDEE_PATTERN = /attendee/;

/**
 * Map a raw Credly badge entry to the application Badge interface.
 * @param entry - Raw Credly API badge entry
 * @returns Mapped Badge object
 */
export function mapCredlyBadgeToBadge(entry: CredlyBadgeEntry): Badge {
  const category = inferBadgeCategory(entry);
  const primaryIssuer = entry.issuer?.entities?.find((e) => e.primary)?.entity;
  const expiresDate = entry.expires_at_date ?? entry.expires_at ?? undefined;
  const firstName = (entry.user?.first_name ?? entry.issued_to_first_name ?? '').trim();
  const middleName = (entry.user?.middle_name ?? entry.issued_to_middle_name ?? '').trim();
  const lastName = (entry.user?.last_name ?? entry.issued_to_last_name ?? '').trim();
  const credlyOrigin = getTrustedCredlyOrigin(entry.user?.url, entry.badge_url, entry.accept_badge_url);
  const credlyProfileSlug = getCredlyProfileSlug(entry.user?.url);
  const privateBadgeEditUrl = credlyProfileSlug && credlyOrigin ? `${credlyOrigin}/users/${credlyProfileSlug}${CREDLY_EDIT_FRAGMENT}` : undefined;
  const isPrivateBadge = !(entry.public ?? false);
  const acceptedBadgeUrl = isPrivateBadge ? privateBadgeEditUrl : (entry.badge_url ?? undefined);
  const credlyUrl = entry.state === 'pending' ? (entry.accept_badge_url ?? undefined) : acceptedBadgeUrl;
  const shareUrl = entry.state === 'accepted' && (entry.public ?? false) ? (entry.badge_url ?? undefined) : undefined;

  return {
    id: entry.id,
    title: entry.badge_template?.name ?? 'Badge',
    description: entry.badge_template?.description ?? '',
    category,
    categoryLabel: getCategoryLabel(category),
    issuedDate: entry.issued_at_date ?? entry.issued_at ?? '',
    issuer: primaryIssuer?.name ?? 'The Linux Foundation',
    firstName,
    middleName: middleName || undefined,
    lastName,
    credentialId: entry.issuer_earner_id ?? entry.id,
    isVerified: entry.state === 'accepted',
    isPublic: entry.public ?? false,
    isPending: entry.state === 'pending',
    expiresDate,
    imageUrl: entry.badge_template?.image_url ?? entry.image_url,
    credlyUrl,
    shareUrl,
  };
}

function getTrustedCredlyOrigin(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsedUrl = new URL(candidate);
      const isTrustedHost = parsedUrl.hostname === 'credly.com' || parsedUrl.hostname.endsWith('.credly.com');
      if (isTrustedHost) {
        return parsedUrl.origin;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Extract the Credly profile slug from a URL like:
 * https://www.credly.com/users/audi-young
 */
function getCredlyProfileSlug(userUrl?: string): string | undefined {
  if (!userUrl) return undefined;
  try {
    const parsedUrl = new URL(userUrl);
    const match = parsedUrl.pathname.match(/^\/users\/([^/]+)$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Infer a badge category from Credly metadata.
 * Uses business routing order from badge tab mapping docs.
 * First matching rule wins.
 * @param entry - Raw Credly API badge entry
 * @returns Inferred BadgeCategory
 */
export function inferBadgeCategory(entry: CredlyBadgeEntry): BadgeCategory {
  const badgeName = normalizeValue(entry.badge_template?.name);
  const typeCategory = normalizeValue(entry.badge_template?.type_category);
  const reportingTags = normalizeReportingTags(entry.badge_template?.reporting_tags);

  // Certifications
  if (hasAnyTag(reportingTags, CERTIFICATION_REPORTING_TAGS)) {
    return typeCategory === 'validation' ? 'learning' : 'certifications';
  }
  if (typeCategory === 'certification') return 'certifications';

  // Learning
  if (hasAnyTag(reportingTags, LEARNING_REPORTING_TAGS)) return 'learning';
  if (typeCategory === 'learning') return 'learning';

  // Speaking (guarded to avoid hijacking project-role badges)
  if (SPEAKING_PATTERN.test(badgeName) && (reportingTags.includes('events') || hasOnlyProjectTags(reportingTags))) {
    return 'speaking';
  }

  // Memberships
  if (MEMBERSHIP_PATTERN.test(badgeName) || badgeName === 'todo ospo associate') return 'memberships';

  // Contributors - tag-based
  if (hasAnyTag(reportingTags, CONTRIBUTOR_REPORTING_TAGS)) return 'contributors';

  // Contributors - name-based
  if (CONTRIBUTOR_PATTERN.test(badgeName)) return 'contributors';

  // Event Participation (attendee-only, ordered before contributor catch-all)
  if (ATTENDEE_PATTERN.test(badgeName)) return 'event-participation';

  // Contributors - partial catch-all for validation/null with project-only tags
  if ((typeCategory === 'validation' || !typeCategory) && hasOnlyProjectTags(reportingTags)) return 'contributors';

  // Program Committee
  if (PROGRAM_COMMITTEE_PATTERN.test(badgeName)) return 'program-committee';

  // Event Participation
  if (reportingTags.includes('events')) return 'event-participation';

  // Catch-all
  return 'contributors';
}

function normalizeValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeReportingTags(reportingTags: string[] | null | undefined): string[] {
  return (reportingTags ?? []).map((tag) => normalizeValue(tag)).filter(Boolean);
}

function hasAnyTag(tags: string[], targetTags: Set<string>): boolean {
  return tags.some((tag) => targetTags.has(tag));
}

function hasOnlyProjectTags(tags: string[]): boolean {
  return tags.length > 0 && tags.every((tag) => PROJECT_TAGS.has(tag));
}

/**
 * Get the human-readable display label for a badge category.
 * Derives from BADGE_FILTER_OPTIONS to keep a single source of truth.
 * @param category - Badge category key
 * @returns Display label string
 */
export function getCategoryLabel(category: BadgeCategory): string {
  return BADGE_FILTER_OPTIONS.find((opt) => opt.id === category)?.label ?? category;
}

/**
 * Returns true if a raw Credly badge entry has the minimum data needed to render a card.
 * Filters out malformed entries and non-accepted/pending states before mapping.
 * @param entry - Raw Credly API badge entry
 */
export function isValidBadge(entry: CredlyBadgeEntry): boolean {
  const firstName = (entry.user?.first_name ?? entry.issued_to_first_name ?? '').trim();
  const lastName = (entry.user?.last_name ?? entry.issued_to_last_name ?? '').trim();

  return !!(entry.id && entry.badge_template?.name && firstName && lastName && (entry.state === 'accepted' || entry.state === 'pending'));
}

/**
 * Compare two badges by issue date, newest first.
 * Invalid or missing dates are sorted last.
 */
export function compareBadgesByIssuedDateDesc(a: Pick<Badge, 'issuedDate'>, b: Pick<Badge, 'issuedDate'>): number {
  return getIssuedDateTimestamp(b.issuedDate) - getIssuedDateTimestamp(a.issuedDate);
}

function getIssuedDateTimestamp(dateValue: string): number {
  const issuedDate = new Date(dateValue).getTime();
  return Number.isNaN(issuedDate) ? -Infinity : issuedDate;
}
