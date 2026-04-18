// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Badge category types matching the filter tabs */
export type BadgeCategory = 'certifications' | 'learning' | 'memberships' | 'speaking' | 'event-participation' | 'contributors' | 'program-committee';

/** Badge status filter values */
export type BadgeStatusFilter = 'all' | 'pending' | 'active' | 'expired';

/** Badge visibility filter values */
export type BadgeVisibilityFilter = 'all' | 'public' | 'private';

/** Badge entity representing an earned achievement (wire type — no client-derived fields) */
export interface Badge {
  /** Unique badge identifier */
  id: string;
  /** Badge display title */
  title: string;
  /** Badge description text */
  description: string;
  /** Category for filtering */
  category: BadgeCategory;
  /** Display label for the category (e.g., "Event Participation") */
  categoryLabel: string;
  /** Date the badge was issued (ISO string) */
  issuedDate: string;
  /** Issuing organization name */
  issuer: string;
  /** Earner first name from Credly profile */
  firstName: string;
  /** Earner middle name from Credly profile (optional) */
  middleName?: string;
  /** Earner last name from Credly profile */
  lastName: string;
  /** Credential ID from the issuer (e.g., issuer_earner_id) */
  credentialId: string;
  /** Whether the badge state is accepted/verified */
  isVerified: boolean;
  /** Whether the earner has made the badge publicly visible on Credly */
  isPublic: boolean;
  /** Whether the badge is in pending state (awaiting acceptance by the earner) */
  isPending: boolean;
  /** Optional expiry date (ISO string) — present only for badges with an expiry */
  expiresDate?: string;
  /** Optional badge image URL */
  imageUrl?: string;
  /** Link to the badge on Credly: pending uses accept_badge_url, accepted public uses badge_url, accepted private uses an edit URL when derivable */
  credlyUrl?: string;
  /** Link to share the badge — only present for accepted badges (badge_url) */
  shareUrl?: string;
}

/** Client-side enriched badge — extends Badge with fields derived from the current timestamp */
export interface EnrichedBadge extends Badge {
  /** Whether the badge credential has expired — computed client-side from expiresDate to avoid cache staleness */
  isExpired: boolean;
}

/** State container for badge data loading */
export interface BadgeState {
  loading: boolean;
  error: boolean;
  data: Badge[];
  /** Error message surfaced from the caught error for debugging */
  errorMessage?: string;
}
