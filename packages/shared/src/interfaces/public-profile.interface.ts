// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shape of the S3 public profile artifact proxied by `/public/api/profile/:username`.
 * Mirrors the artifact's own mixed-case field names; the server passes it through verbatim.
 */
export interface PublicProfile {
  /**
   * Normalized public gate written by the proxy. `true` only when the upstream artifact's
   * public flag is explicitly boolean `true`; a missing or non-boolean flag resolves to
   * `false` (fail closed — the proxy withholds the payload for anything but an explicit opt-in).
   */
  isPublic: boolean;
  /** Raw upstream public flag, preserved as-is for reference. */
  IsPublic?: boolean;
  basic?: PublicProfileBasic;
  /** Long-form bio / about section (HTML or markdown). */
  About?: string;
  technical_contribution?: PublicProfileTechnicalContribution;
  /** Best-effort shape — absent from the reference sample; reconfirm against a live artifact. */
  training_activities?: PublicProfileTraining[] | null;
  certification_activities?: PublicProfileCertification[];
  badges?: PublicProfileBadge[];
  skills?: PublicProfileSkill[];
  /** Best-effort shape — absent from the reference sample; reconfirm against a live artifact. */
  presentations?: PublicProfilePresentation[];
}

/** View-model for a rendered social link in the public profile hero. */
export interface PublicProfileSocialLink {
  label: string;
  url: string;
}

export interface PublicProfileBasic {
  Name?: string;
  LogoURL?: string;
  TwitterID?: string;
  LinkedInID?: string;
  GithubID?: string;
  Username?: string;
  Title?: string;
  Bio?: string;
  /** Current employer/affiliation shown as "{Title} at {AccountName}"; a value containing "Individual" is a placeholder and is hidden. */
  AccountName?: string;
  AccountLogoURL?: string;
  Identities?: PublicProfileIdentity[];
}

export interface PublicProfileIdentity {
  Username?: string;
  Avatar?: string;
}

export interface PublicProfileTechnicalContribution {
  projects: PublicProfileProject[];
}

// Backed by upstream `ProjectContribution` — JSON keys mix casing: `ID`/`LogoURL`/`Name`/`Slug`
// are PascalCase, the rest (`affiliations`, `commits`, `added`, …) are lowercase. `ID`, `LogoURL`,
// `Name`, and `Slug` are all `omitempty` upstream (the transform sets `Name`/`Slug` from source
// project data that can be empty, and never populates `ID`), so each may be absent — render a
// fallback rather than assuming `Name` is present.
export interface PublicProfileProject {
  ID?: string;
  LogoURL?: string;
  Name?: string;
  Slug?: string;
  affiliations?: PublicProfileAffiliation[];
  commits: number;
  deleted: number;
  added: number;
  prs: number;
  issues: number;
  docs: number;
  contributions?: PublicProfileContribution[];
}

export interface PublicProfileAffiliation {
  ID?: string;
  Level?: string;
  Organization?: PublicProfileAffiliationOrganization;
  StartDate?: string;
  EndDate?: string;
}

export interface PublicProfileAffiliationOrganization {
  ID?: string;
  LogoURL?: string;
  Name?: string;
}

export interface PublicProfileContribution {
  date: string;
  commits: number;
  added: number;
  deleted: number;
  prs: number;
  issues: number;
  docs: number;
  count: number;
}

// Backed by the same upstream `Activity` struct as PublicProfileTraining — JSON keys
// are PascalCase (`ID`, `Name`, `Status`, `StartDate`, `EndDate`, `Type`), all `omitempty`.
// The raw S3 artifact is consumed without transformation, so the casing must match.
export interface PublicProfileCertification {
  ID?: string;
  Name?: string;
  Status?: string;
  StartDate?: string;
  EndDate?: string;
  Type?: string;
}

export interface PublicProfileTraining {
  Name?: string;
  Status?: string;
  Type?: string;
  StartDate?: string;
  EndDate?: string;
}

// Upstream Badge (user-service preference.Badge): both fields carry `omitempty`,
// so each may be absent. JSON keys are PascalCase `Image` / `Url` — the raw S3
// artifact is consumed without transformation, so the casing must match exactly.
export interface PublicProfileBadge {
  Image?: string;
  Url?: string;
}

export interface PublicProfileSkill {
  ID: string;
  Name: string;
}

export interface PublicProfilePresentation {
  Name?: string;
  EventURL?: string;
  StartDate?: string;
  EndDate?: string;
  LocationName?: string;
}
