// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shape of the public profile artifact published to S3 by the upstream
 * `GenerateUserPublicProfile` flow and proxied by `/public/api/profile/:username`.
 *
 * The LFX One server is a thin proxy — it fetches the JSON verbatim, gates on the
 * public flag, and passes the payload through untransformed. These interfaces mirror
 * the artifact's own (mixed-case) field names rather than renaming them.
 *
 * Field casing is taken from the reference artifact sample
 * (`myprofile/frontend/public/profiles/example.json`): `basic`, `technical_contribution`,
 * `community_roles`, and `event_activities` use PascalCase members, while
 * `certification_activities` and `skills` use their own casing. Some optional sections
 * (`presentations`, `training_activities`) are not present in that sample, so their member
 * shapes are best-effort and should be reconfirmed against a live artifact when the public
 * page UI consumes them.
 */
export interface PublicProfile {
  /**
   * Normalized public gate written by the proxy. `true` when the upstream artifact's
   * public flag is truthy or absent; `false` only when it is explicitly disabled.
   */
  isPublic: boolean;
  /** Raw upstream public flag, preserved as-is for reference. */
  IsPublic?: boolean;
  basic?: PublicProfileBasic;
  /** Long-form bio / about section (HTML or markdown). */
  About?: string;
  technical_contribution?: PublicProfileTechnicalContribution;
  community_roles?: PublicProfileCommunityRole[];
  event_activities?: PublicProfileEvent[];
  training_activities?: PublicProfileTraining[] | null;
  certification_activities?: PublicProfileCertification[];
  badges?: PublicProfileBadge[];
  skills?: PublicProfileSkill[];
  presentations?: PublicProfilePresentation[];
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

export interface PublicProfileProject {
  ID: string;
  LogoURL?: string;
  Name: string;
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

export interface PublicProfileCommunityRole {
  ID: string;
  LogoURL?: string;
  roles: PublicProfileCommunityRoleEntry[];
}

export interface PublicProfileCommunityRoleEntry {
  Name: string;
  Role: string;
  RoleStartDate?: string;
  RoleEndDate?: string;
}

export interface PublicProfileEvent {
  ID: string;
  Name: string;
  StartDate?: string;
  EndDate?: string;
  EventURL?: string;
  LocationName?: string;
}

export interface PublicProfileCertification {
  id: string;
  name: string;
  status: string;
  startDate?: string;
  endDate?: string;
  type?: string;
}

export interface PublicProfileTraining {
  Name?: string;
  Status?: string;
  Type?: string;
  StartDate?: string;
  EndDate?: string;
}

export interface PublicProfileBadge {
  image: string;
  url?: string;
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
