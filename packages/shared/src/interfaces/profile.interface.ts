// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile tab configuration for the profile layout navigation
 */
export interface ProfileTab {
  id: string;
  label: string;
  route: string;
  icon?: string;
  visible?: boolean; // For role-based visibility (future)
}

/**
 * Connected identity provider types
 */
export type IdentityProvider = 'github' | 'gitlab' | 'linkedin' | 'google' | 'email' | 'lfid';

/**
 * Connected identity for the Overview tab
 */
export interface ConnectedIdentity {
  id: string;
  provider: IdentityProvider;
  identifier: string;
  verified: boolean;
  icon?: string;
}

/**
 * Profile header data displayed in the profile layout card
 * Extends and normalizes the UserMetadata for display purposes
 */
export interface ProfileHeaderData {
  firstName: string;
  lastName: string;
  username: string;
  email?: string;
  jobTitle?: string;
  organization?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  phoneNumber?: string;
  tshirtSize?: string;
  avatarUrl?: string;
}

/**
 * Skill item for skill management
 */
export interface ProfileSkill {
  id: string;
  name: string;
  category?: string;
}

/**
 * Verification choice for identity verification dialog
 */
export type VerificationChoice = 'yes' | 'no' | undefined;

/**
 * Map of identity ID to verification choice
 */
export type VerificationChoices = Record<string, VerificationChoice>;

/**
 * Map of identity ID to contribution count
 */
export type ContributionCounts = Record<string, number>;

/**
 * Work experience verification status
 */
export type WorkExperienceStatus = 'Verified' | 'Unverified' | 'Suggested';

/**
 * Work experience entry for Work Experience tab
 */
export interface WorkExperience {
  id: string;
  organization: string;
  organizationId?: string;
  role?: string;
  startDate: string;
  endDate?: string;
  status: WorkExperienceStatus;
}

/**
 * Email option for email preference dropdowns
 */
export interface EmailOption {
  label: string;
  value: string | null;
}

/**
 * Dialog data for add/edit work experience form
 */
export interface WorkExperienceFormDialogData {
  mode: 'add' | 'edit';
  experience?: WorkExperience;
}

// --- Attribution Tab Redesign Types ---

/**
 * Role types for attribution affiliations
 */
export type AffiliationRole = 'Contributor' | 'Maintainer';

/**
 * How the role was determined
 */
export type AffiliationRoleSource = 'cdp-detected' | 'repo-file' | 'user-confirmed' | 'user-overridden';

/**
 * Human-readable labels for affiliation sources
 */
export type AffiliationSourceLabel = 'Confirmed by user' | 'Derived from work experience' | 'Repository file';

/**
 * Source type for affiliations
 */
export type AffiliationSourceType = 'inferred' | 'repo-file' | 'user-confirmed' | 'user-overridden';

/**
 * Source for work experience entries
 */
export type WorkExperienceSource = 'manual' | 'cdp-enriched';

/**
 * Time-bound affiliation within a project
 */
export interface AffiliationSegment {
  id: string;
  role: AffiliationRole;
  roleSource: AffiliationRoleSource;
  organization: string;
  organizationLogo?: string;
  startDate: string;
  endDate?: string;
  sourceLabel: AffiliationSourceLabel;
  sourceType: AffiliationSourceType;
  needsConfirmation: boolean;
}

/**
 * Groups affiliation segments under a project
 */
export interface ProjectGroup {
  id: string;
  projectName: string;
  projectLogo?: string;
  segments: AffiliationSegment[];
  disabledOrgSuggestions?: DisabledOrgSuggestion[];
}

/**
 * Flattened row for rendering affiliations in lfx-table.
 * Each row represents one segment with metadata about its position within the group.
 */
export interface FlatAffiliationRow {
  group: ProjectGroup;
  segment: AffiliationSegment;
  isFirstSegment: boolean;
  isLastSegmentInGroup: boolean;
  isLastGroup: boolean;
  isPlaceholder?: boolean;
}

/**
 * Work experience entry with source tracking
 */
export interface WorkExperienceEntry {
  id: string;
  organization: string;
  organizationId?: string;
  organizationLogo?: string;
  jobTitle: string;
  startDate: string;
  endDate?: string;
  source: WorkExperienceSource;
  cdpSource?: string;
  needsReview?: boolean;
}

/**
 * Request body sent from frontend to BFF for creating/updating work experience
 */
export interface WorkExperienceCreateUpdateBody {
  organizationId: string;
  jobTitle: string;
  source: string;
  startDate: string;
  endDate?: string | null;
}

/**
 * Full request body sent from BFF to CDP API for creating/updating work experience
 * Includes verified/verifiedBy fields injected by the backend
 */
export interface CdpWorkExperienceRequest {
  organizationId: string;
  jobTitle: string;
  source: string;
  startDate: string;
  endDate?: string | null;
  verified: boolean;
  verifiedBy: string;
}

/**
 * Disabled org suggestion derived from non-project-type affiliations
 * Shown as toggled-off cards in the affiliation timeline dialog
 */
export interface DisabledOrgSuggestion {
  organizationName: string;
  organizationId: string;
  organizationLogo?: string;
  earliestStartDate: string;
  latestEndDate?: string;
}

/**
 * Timeline data for a single project in the affiliation timeline dialog
 */
export interface TimelineProjectData {
  projectName: string;
  segments: AffiliationSegment[];
  disabledOrgSuggestions?: DisabledOrgSuggestion[];
}

/**
 * Work experience timeline entry for the affiliation timeline dialog
 */
export interface TimelineWorkExperience {
  organization: string;
  color: string;
  startDate: string;
  endDate: string | null;
}

/**
 * Project affiliation entry in work experience confirmation dialog
 */
export interface WorkExperienceProjectAffiliation {
  id: string;
  projectName: string;
  projectLogo?: string;
  detectedRole: AffiliationRole;
  enabled: boolean;
}

/**
 * Work experience update detected by the system
 */
export interface WorkExperienceUpdate {
  id: string;
  organization: string;
  organizationLogo?: string;
  jobTitle: string;
  startDate: string;
  endDate?: string;
  status: 'New' | 'Updated';
  projectAffiliations: WorkExperienceProjectAffiliation[];
}

/**
 * A project affiliation that the user disabled during work experience confirmation
 */
export interface DisabledAffiliation {
  projectName: string;
  organization: string;
}

/**
 * Result emitted when the user confirms work experience updates
 */
export interface WorkExperienceConfirmationResult {
  disabledAffiliations: DisabledAffiliation[];
}

/**
 * Data passed to the maintainer confirmation dialog
 */
export interface MaintainerConfirmationDialogData {
  projectName: string;
}

/**
 * Result from the maintainer confirmation dialog
 */
export type MaintainerConfirmationResult = 'maintainer' | 'contributor';

/**
 * Social identity providers supported for OAuth verification flow
 */
export type SocialProvider = 'github' | 'google' | 'linkedin';

/**
 * Pending social connection stored in session during Flow C chain
 */
export interface PendingSocialConnect {
  provider: SocialProvider;
  returnTo: string;
}

/**
 * Identity provider option for the Add Account dialog
 */
export interface IdentityProviderOption {
  id: IdentityProvider;
  name: string;
  description: string;
  icon: string;
}

/**
 * Dialog data for adding a new identity account
 */
export interface AddAccountDialogData {
  existingProviders: IdentityProvider[];
}

/**
 * Result from the add account dialog
 */
export interface AddAccountDialogResult {
  provider: IdentityProvider;
  identifier: string;
}

/**
 * Dialog data for verifying an identity
 */
export interface VerifyIdentityDialogData {
  identity: ConnectedIdentityFull;
}

/**
 * Dialog data for removing an identity
 */
export interface RemoveIdentityDialogData {
  identity: ConnectedIdentityFull;
}

/**
 * Identity verification state
 */
export type IdentityState = 'verified' | 'unverified';

/**
 * Full connected identity for the Identities tab
 */
export interface ConnectedIdentityFull {
  id: string;
  provider: IdentityProvider;
  identifier: string;
  state: IdentityState;
  icon: string;
  isPrimary?: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
  contributions?: number;
  auth0UserId?: string;
}

/**
 * Data passed to the affiliation timeline dialog
 */
export interface AffiliationTimelineDialogData {
  projects: TimelineProjectData[];
  startProjectIndex?: number;
  workExperience?: WorkExperienceEntry[];
}

/**
 * Editable period within an affiliation org card (dialog internal state)
 */
export interface AffiliationEditPeriod {
  id: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  isPresent: boolean;
}

/**
 * Organization edit state for the affiliation timeline dialog
 */
export interface AffiliationEditOrg {
  organization: string;
  organizationLogo?: string;
  enabled: boolean;
  periods: AffiliationEditPeriod[];
  weStartDate?: string;
  weEndDate?: string;
}

/**
 * Positioned segment for date-based timeline rendering
 */
export interface PositionedSegment {
  segment: AffiliationSegment;
  leftPercent: number;
  widthPercent: number;
  color: string;
}

/**
 * Profile auth status response for Flow C management token
 */
export interface ProfileAuthStatus {
  authorized: boolean;
  configured: boolean;
}

/**
 * Request body for PATCH /v1/members/{memberId}/project-affiliations/{projectId}
 * Sends the full CDP project shape so the backend can overwrite the entire project record.
 */
export interface ProjectAffiliationPatchBody {
  id: string;
  projectSlug: string;
  verified: boolean;
  verifiedBy: string;
  affiliations: CdpProjectAffiliationEntry[];
}

// --- CDP (Community Data Platform) Identity Types ---

/**
 * CDP member resolve request body
 */
export interface CdpResolveRequest {
  lfids: string[];
  emails?: string[];
}

/**
 * CDP member resolve response
 */
export interface CdpResolveResponse {
  memberId: string;
}

/**
 * Raw identity from CDP API response
 */
export interface CdpIdentityRaw {
  id: string;
  value: string;
  platform: string;
  verified: boolean;
  verifiedBy?: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CDP identities API response envelope
 */
export interface CdpIdentitiesResponse {
  identities: CdpIdentityRaw[];
}

/**
 * Request body for creating a new identity in CDP
 */
export interface CdpCreateIdentityRequest {
  value: string;
  platform: string;
  type: string;
  source: string;
  verified: boolean;
  verifiedBy: string;
}

/**
 * Mapped identity for frontend display
 */
export interface CdpIdentity {
  id: string;
  platform: string;
  value: string;
  verified: boolean;
  verifiedBy?: string | null;
  source: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

// --- Auth0 Linked Identity Types ---

/**
 * Identity linked to the user's Auth0 account
 * Represents what the logged-in user actually owns (source of truth for ownership)
 */
export interface Auth0Identity {
  provider: string;
  user_id: string;
  connection: string;
  isSocial: boolean;
  profileData?: { email?: string; nickname?: string; name?: string; [key: string]: unknown };
}

/**
 * Display state for an identity after cross-referencing CDP with Auth0
 * - verified: owned by user and confirmed
 * - unverified: needs user verification
 * - hidden: belongs to another LFID merged into CDP, not shown
 */
export type IdentityDisplayState = 'verified' | 'unverified' | 'hidden';

/**
 * CDP identity enriched with Auth0 cross-reference data
 * Returned by the identities endpoint after applying display logic
 */
export interface EnrichedIdentity extends CdpIdentity {
  displayState: IdentityDisplayState;
  inAuth0: boolean;
  auth0UserId?: string;
}

// --- CDP Work Experience Types ---

/**
 * Raw work experience from CDP API response
 */
export interface CdpWorkExperience {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationLogo: string;
  jobTitle: string;
  verified: boolean;
  verifiedBy: string | null;
  source: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * CDP work experiences API response envelope
 */
export interface CdpWorkExperiencesResponse {
  memberId: string;
  workExperiences: CdpWorkExperience[];
}

// --- Email Verification NATS Types ---

/**
 * Response from NATS email verification send-code request
 */
export interface SendEmailVerificationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Response from NATS email OTP verification request
 */
export interface VerifyEmailOtpNatsResponse {
  success: boolean;
  data?: {
    access_token: string;
    id_token: string;
    scope: string;
    expires_in: number;
    token_type: string;
  };
  message?: string;
  error?: string;
}

/**
 * Response from NATS user identity link request
 */
export interface LinkIdentityNatsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Response from NATS user identity unlink request
 */
export interface UnlinkIdentityNatsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Response from NATS password reset link request
 */
export interface ResetPasswordLinkNatsResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Response from NATS user identity list request
 */
export interface ListIdentitiesNatsResponse {
  success: boolean;
  data?: Auth0Identity[];
  message?: string;
  error?: string;
}

/**
 * Combined response from verify OTP + link identity flow
 */
export interface VerifyAndLinkEmailResponse {
  success: boolean;
  message?: string;
  error?: string;
  authorize_url?: string;
}

// --- CDP Project Affiliation Types ---

/**
 * Role entry within a CDP project affiliation
 */
export interface CdpProjectAffiliationRole {
  id: string;
  role: string;
  startDate: string;
  endDate: string;
  repoUrl: string;
  repoFileUrl: string;
}

/**
 * Organization affiliation entry within a CDP project affiliation
 */
export interface CdpProjectAffiliationEntry {
  id?: string;
  organizationLogo: string;
  organizationId: string;
  organizationName: string;
  verified: boolean;
  verifiedBy: string;
  source: string;
  startDate: string;
  endDate: string | null;
  type: string;
}

/**
 * CDP project affiliation grouping projects with their roles and org affiliations
 */
export interface CdpProjectAffiliation {
  id: string;
  projectSlug: string;
  projectLogo: string;
  projectName: string;
  contributionCount: number;
  roles: CdpProjectAffiliationRole[];
  affiliations: CdpProjectAffiliationEntry[];
}
