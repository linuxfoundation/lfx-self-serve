// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Client-facing public profile shape. The proxy projects the S3 artifact down to only the fields
 * the public page renders (see `projectPublicProfile`), so unrendered PII never ships to the client.
 */
export interface PublicProfile {
  /**
   * Normalized public gate written by the proxy. `true` only when the upstream artifact's public
   * flag is explicitly boolean `true`; a missing or non-boolean flag fails closed to `false`.
   */
  isPublic: boolean;
  basic?: PublicProfileBasic;
  /** Long-form bio / about section (HTML or markdown). */
  About?: string;
  technical_contribution?: PublicProfileTechnicalContribution;
  training_activities?: PublicProfileTraining[] | null;
  certification_activities?: PublicProfileCertification[];
  badges?: PublicProfileBadge[];
}

/**
 * UI state for the public profile page: loading spinner, unexpected-error fallback, the resolved
 * profile, or the inline not-found view (`isPrivate` selects the private vs. missing-profile copy).
 */
export interface PublicProfilePageState {
  loading: boolean;
  error: boolean;
  notFound: boolean;
  isPrivate: boolean;
  profile: PublicProfile | null;
}

/** View-model for a rendered social link in the public profile hero. */
export interface PublicProfileSocialLink {
  label: string;
  url: string;
}

export interface PublicProfileBasic {
  Name?: string;
  LogoURL?: string;
  /**
   * Proxy-derived avatar URL (camelCase — unlike the PascalCase fields above, not sourced from the
   * upstream artifact). Guessed from the profile's username using the same key convention as the
   * avatar-upload service; existence is not verified server-side. The client should prefer this
   * over LogoURL and fall back to LogoURL on load error, since it reflects any avatar the user has
   * uploaded through this app, which LogoURL (a separate, batch-generated artifact) does not.
   */
  avatarUrl?: string;
  TwitterID?: string;
  LinkedInID?: string;
  GithubID?: string;
  Title?: string;
  Bio?: string;
  /** Current employer/affiliation shown as "{Title} at {AccountName}"; a value containing "Individual" is a placeholder and is hidden. */
  AccountName?: string;
  AccountLogoURL?: string;
  Identities?: PublicProfileIdentity[];
}

export interface PublicProfileIdentity {
  Username?: string;
}

export interface PublicProfileTechnicalContribution {
  projects: PublicProfileProject[];
}

// Backed by upstream `ProjectContribution` — `Name`/`Slug`/`LogoURL` are PascalCase and `omitempty`
// (render a fallback rather than assuming `Name`), while the contribution counts are lowercase.
export interface PublicProfileProject {
  LogoURL?: string;
  Name?: string;
  Slug?: string;
  commits: number;
  deleted: number;
  added: number;
  prs: number;
  issues: number;
}

// Backed by the upstream `Activity` struct (shared with PublicProfileTraining) — PascalCase keys,
// all `omitempty`. The raw S3 artifact is consumed without transformation, so the casing must match.
export interface PublicProfileCertification {
  Name?: string;
  StartDate?: string;
  EndDate?: string;
  Type?: string;
}

export interface PublicProfileTraining {
  Name?: string;
  Type?: string;
  StartDate?: string;
  EndDate?: string;
}

// Upstream Badge (user-service preference.Badge): both fields carry `omitempty`, so each may be
// absent. JSON keys are PascalCase `Image` / `Url`, consumed without transformation.
export interface PublicProfileBadge {
  Image?: string;
  Url?: string;
}
