// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Project } from './project.interface';

export type NewsletterStatusTabId = 'draft' | 'scheduled' | 'sent' | 'optout';

/**
 * Newsletter lifecycle states: `draft → sending → sent`, or
 * `draft → sending → scheduled → sent` when a schedule is armed.
 *
 * `sending` is the transient state between the newsletter-service accepting a
 * send or schedule request (202) and the background fan-out settling — to
 * `sent` (immediate send) or `scheduled` (armed schedule) on completion, or
 * back to `draft` when zero recipients could be delivered/scheduled to. The
 * upstream `status=sent` list filter also matches `sending` rows, so an
 * in-flight *send* appears on the Sent tab — but an in-flight *schedule arm*
 * (a `sending` row that carries `scheduled_at`) is a distinct case the UI must
 * exclude from Sent and surface on the Scheduled tab instead, since
 * `status=scheduled` alone does not match it. `scheduled` rows are excluded
 * from both the `draft` and `sent` filters, so they need their own tab to stay
 * reachable. A background sweep (every 5 minutes) flips a `scheduled` row to
 * `sent` once its `scheduled_at` has passed — display-state reconciliation
 * only; SendGrid delivers on its own timing regardless of the sweep.
 */
export type NewsletterStatus = 'draft' | 'sending' | 'scheduled' | 'sent';

/**
 * Top-level view shown by the newsletter manage screen.
 *
 * - `review`: summary cards over the saved draft with explicit edit affordances (default on reopen).
 * - `step`: linear stepper (default for create, opt-in for edit when a section's "Edit" is clicked).
 */
export type NewsletterManageViewMode = 'review' | 'step';

export interface NewsletterCommitteeOption {
  label: string;
  value: string;
  category: string;
}

export interface NewsletterRecipientCountPayload {
  committee_uids: string[];
}

/**
 * Lifecycle of a single inline "add email to the audience group" attempt.
 *
 * - `pending`: the create-member request is in flight.
 * - `added`: the member was created in the group (with notification suppressed).
 * - `already`: the group already has a member with this email — benign outcome.
 * - `invalid`: the input failed client-side email validation; no request was sent.
 * - `failed`: the create-member request was rejected upstream.
 */
export type NewsletterAudienceEmailAddStatus = 'pending' | 'added' | 'already' | 'invalid' | 'failed';

/**
 * Per-email state for the audience step's inline add-to-group flow. Owned by
 * the manage host (the stepper destroys the step panel on navigation) and
 * rendered by the audience step filtered to the currently selected group.
 */
export interface NewsletterAudienceEmailAdd {
  /** Normalized (trimmed, lowercased) email — invalid tokens are normalized the same way. */
  email: string;
  /** Committee the add was fired against — list rendering is scoped by this. */
  committeeUid: string;
  status: NewsletterAudienceEmailAddStatus;
  /** Human-readable reason shown for `invalid` / `failed`. */
  reason?: string;
}

export interface NewsletterRecipientCount {
  count: number;
}

export interface NewsletterRecipient {
  email: string;
  first_name?: string;
}

export interface NewsletterRecipientsResponse {
  recipients: NewsletterRecipient[];
}

export interface NewsletterTestSendPayload {
  subject: string;
  body_html: string;
  to_email: string;
}

export interface NewsletterSendFailure {
  email: string;
  error: string;
}

/**
 * Response of POST …/newsletters/{uid}/send.
 *
 * The upstream send is asynchronous: acceptance returns the newsletter in
 * `status='sending'` with `sent=0`, and the fan-out completes in a detached
 * background job. Branch on `newsletter.status` — `'sent'` means the send
 * settled synchronously (zero-recipient edge case, or a pre-async upstream).
 */
export interface NewsletterSendResult {
  newsletter: Newsletter;
  group_id: string;
  total_recipients: number;
  sent: number;
  failed: number;
  failures?: NewsletterSendFailure[];
}

/** Optional body of POST …/newsletters/{uid}/schedule — overrides the draft's saved `scheduled_at`. */
export interface NewsletterSchedulePayload {
  scheduled_at: string;
}

/**
 * Response of POST …/newsletters/{uid}/schedule. Mirrors NewsletterSendResult
 * plus the `scheduled_at` actually armed (the request's override, or the
 * draft's own saved value). Same async-acceptance shape as send: branch on
 * `newsletter.status` ('sending' while the arm fan-out runs, settling to
 * 'scheduled').
 */
export interface NewsletterScheduleResult {
  newsletter: Newsletter;
  group_id: string;
  scheduled_at: string;
  total_recipients: number;
  sent: number;
  failed: number;
  failures?: NewsletterSendFailure[];
}

/** Response of POST …/newsletters/{uid}/cancel-schedule — the reverted (draft) newsletter. */
export interface NewsletterCancelScheduleResult {
  newsletter: Newsletter;
}

export interface Newsletter {
  id: string;
  project_uid: string;
  subject: string;
  body_html: string;
  ed_reply_email: string;
  committee_uids: string[];
  status: NewsletterStatus;
  sent_at?: string;
  /**
   * Two meanings depending on `status`: while `draft`, the author's saved
   * intent — saving it does not by itself contact the send provider. Once
   * `status='scheduled'`, the committed release time armed at the provider.
   * Null when no schedule has ever been set. Survives cancel-schedule (which
   * reverts to `draft` but retains this value) so re-arming doesn't require
   * re-entering the time.
   */
  scheduled_at?: string;
  group_id?: string;
  total_recipients: number;
  created_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Load state of the standalone newsletter reader page
 * (/newsletters/:projectSlug/:id). A single object so loading, resolution
 * failures, and draft gating all derive from one stream emission.
 */
export interface NewsletterReaderState {
  loading: boolean;
  /** Unexpected failure (non-404) loading the newsletter — distinct from notFound so 5xx never renders as a permanent 404. */
  error: boolean;
  project: Project | null;
  newsletter: Newsletter | null;
  /** Server access decision for the reader; null while loading, on error, or when nothing resolved. */
  access: NewsletterReaderAccess | null;
  /** The issue exists but is unsent and the reader is not a manager (draft notice, SSR 404). */
  draftHidden?: boolean;
}

/**
 * Why the reader may open an issue:
 * - `manager` — project writer (drafts included)
 * - `auditor` — project auditor (LF staff included); reads sent issues, never auto-joined
 * - `group_member` — already in one of the issue's audience committees
 * - `eligible` — verified email at an active Linux Foundation member company; the reader page then
 *   adds that email to the newsletter group (the member benefit)
 * - `denied` — none of the above; the body is withheld
 */
export type NewsletterReaderAccessLevel = 'manager' | 'auditor' | 'group_member' | 'eligible' | 'denied';

/** Why a reader was denied: no verified company email, a company that is not an LF member, or an issue with no newsletter group to join. */
export type NewsletterReaderDeniedReason = 'no_company_email' | 'not_member_company' | 'no_newsletter_group';

/** Response of GET /api/newsletters/:projectUid/:newsletterUid/reader. */
export interface NewsletterReaderAccess {
  access: NewsletterReaderAccessLevel;
  /** Present for every level except `denied`. */
  newsletter?: Newsletter;
  denied_reason?: NewsletterReaderDeniedReason;
  /** `eligible` only: the verified work email that qualified and will be added. */
  qualifying_email?: string;
  /** `eligible` only: the matched Linux Foundation member company. */
  company_name?: string;
  /** `eligible` only: the newsletter group the email will be added to. */
  committee_name?: string;
}

/** Outcome of POST /api/newsletters/:projectUid/:newsletterUid/join. */
export type NewsletterJoinStatus = 'added' | 'already_member';

/** Response of POST /api/newsletters/:projectUid/:newsletterUid/join. */
export interface NewsletterJoinResult {
  status: NewsletterJoinStatus;
  email: string;
  committee_name: string;
  company_name: string;
}

/** Reader-page state of the automatic member-benefit group add. */
export interface NewsletterJoinState {
  status: 'idle' | 'joining' | NewsletterJoinStatus | 'failed';
  result?: NewsletterJoinResult;
}

/** A verified email that qualified for the member benefit, with the member company it matched. */
export interface NewsletterMemberBenefitMatch {
  email: string;
  b2b_org_uid: string;
  company_name: string;
}

/** Result of the member-benefit eligibility check for the signed-in user. */
export interface NewsletterMemberBenefitEligibility {
  /** Lowercased verified emails of the user (used for the group-membership check). */
  verified_emails: string[];
  match: NewsletterMemberBenefitMatch | null;
  /** Set when `match` is null. */
  denied_reason?: Extract<NewsletterReaderDeniedReason, 'no_company_email' | 'not_member_company'>;
}

/** One active Linux Foundation member company recorded against a domain. */
export interface MemberBenefitCompany {
  b2b_org_uid: string;
  company_name: string;
}

/** Index of active Linux Foundation memberships: domain → companies, plus the set of active member org uids. */
export interface MemberBenefitDomainIndex {
  by_domain: Map<string, MemberBenefitCompany[]>;
  active_org_uids: Map<string, string>;
}

/** The newsletter group (Newsletter-category committee) a member is added to. */
export interface NewsletterMemberBenefitGroup {
  uid: string;
  name: string;
}

/** Server-side outcome of the newsletter reader access ladder (BFF-internal; never serialized as-is). */
export type NewsletterReaderEvaluation =
  | { level: 'manager' | 'auditor' | 'group_member'; newsletter: Newsletter }
  | { level: 'eligible'; newsletter: Newsletter; match: NewsletterMemberBenefitMatch; group: NewsletterMemberBenefitGroup }
  | { level: 'denied'; newsletter: Newsletter; reason: NewsletterReaderDeniedReason };

/** A foundation as shown on the My Newsletters cards and drill-down header. */
export interface NewsletterFoundationSummary {
  uid: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

/**
 * The project whose active corporate memberships qualify a company for a newsletter's member
 * benefit: the newsletter's own foundation when it is membership-funded, else The Linux Foundation.
 */
export interface NewsletterMembershipScope {
  /** `project_membership.project_slug` to match. */
  slug: string;
  name: string;
}

/** Why the signed-in user cannot invite from one card. */
export type MyNewsletterInviteDeniedReason = 'no_company_email' | 'not_member_company' | 'no_newsletter_group' | 'unavailable';

/** One card of the Me-lens My Newsletters grid: a foundation the user receives newsletters from. */
export interface MyNewsletterFoundation extends NewsletterFoundationSummary {
  /** Sent issues the user received through their current group memberships. */
  received_count: number;
  last_sent_at: string | null;
  /** The user's own Newsletter-category group of this foundation, if any — the group invites add to. */
  newsletter_group: NewsletterMemberBenefitGroup | null;
  /** Inviter is in this foundation's newsletter group and works at a member of {@link membership_name}. */
  can_invite: boolean;
  /** The organization whose member companies can be invited; null without a newsletter group. */
  membership_name: string | null;
  /** Set when `can_invite` is false. */
  invite_denied_reason?: MyNewsletterInviteDeniedReason;
}

/** Whether the signed-in user may invite coworkers from at least one card (each card decides for its own foundation). */
export interface MyNewsletterInviter {
  eligible: boolean;
  company_name: string | null;
  /** Set when not eligible; `unavailable` when the check itself could not run. */
  denied_reason?: NewsletterMemberBenefitEligibility['denied_reason'] | 'unavailable';
}

/** Response of GET /api/newsletters/my-foundations. */
export interface MyNewsletterFoundationsResponse {
  foundations: MyNewsletterFoundation[];
  /** The same feed as GET /api/newsletters/my-newsletters, tagged with the owning foundation. */
  newsletters: MyNewsletter[];
  complete: boolean;
  inviter: MyNewsletterInviter;
}

/** Frontend load state of the My Newsletters foundations response. */
export interface MyNewsletterFoundationsState {
  loading: boolean;
  error: boolean;
  data: MyNewsletterFoundationsResponse | null;
}

/** Body of POST /api/newsletters/foundations/:foundationUid/invites. */
export interface NewsletterInviteRequest {
  email: string;
}

/** Response of POST /api/newsletters/foundations/:foundationUid/invites. */
export interface NewsletterInviteResult {
  email: string;
  foundation_name: string;
}

/** DynamicDialog data of the My Newsletters invite dialog. */
export interface NewsletterInviteDialogData {
  foundation: MyNewsletterFoundation;
}

/** Data the newsletter invite email is rendered from. */
export interface NewsletterInviteEmailContext {
  inviter_name: string;
  company_name: string;
  foundation_name: string;
  accept_url: string;
}

/** A rendered transactional email. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Request of the lfx-v2-email-service `send_email` NATS subject (pre-rendered; one recipient). */
export interface EmailServiceSendRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
  from_display_name?: string;
}

/** Reply of the lfx-v2-email-service `send_email` NATS subject — empty ids when sending is disabled or filtered. */
export interface EmailServiceSendResponse {
  email_id?: string;
  group_id?: string;
  error?: string;
}

/** Invite landing outcome for the signed-in user against one newsletter group. */
export type NewsletterGroupJoinState = 'eligible' | 'already_member' | 'denied';

/** Response of GET /api/newsletters/groups/:committeeUid/join-status. */
export interface NewsletterGroupJoinStatus {
  state: NewsletterGroupJoinState;
  group: NewsletterMemberBenefitGroup;
  foundation: NewsletterFoundationSummary;
  /** The organization the invitee's company must be a member of. */
  membership_name: string;
  /** `denied` only. */
  denied_reason?: NewsletterMemberBenefitEligibility['denied_reason'];
  /** `eligible` only: the verified work email that will be added. */
  email?: string;
  /** `eligible` only: the matched member company. */
  company_name?: string;
}

/** A project resolved to the foundation it rolls up to, with that foundation's membership scope (BFF-internal). */
export interface ResolvedNewsletterFoundation {
  foundation: NewsletterFoundationSummary;
  membership: NewsletterMembershipScope;
}

/** A Newsletter-category group the user belongs to, with the foundation it rolls up to (BFF-internal). */
export interface FoundationNewsletterGroup extends ResolvedNewsletterFoundation {
  group: NewsletterMemberBenefitGroup;
}

/** Server-side outcome of the invite landing check — the match is never serialized (BFF-internal). */
export type NewsletterGroupJoinEvaluation =
  | { state: 'already_member'; status: NewsletterGroupJoinStatus }
  | { state: 'denied'; status: NewsletterGroupJoinStatus }
  | { state: 'eligible'; status: NewsletterGroupJoinStatus; match: NewsletterMemberBenefitMatch };

/** Drill-down state of the invite confirmation panel. */
export interface NewsletterInviteLandingState {
  status: 'idle' | 'loading' | 'invalid' | 'error' | 'ready' | 'joining' | NewsletterJoinStatus | 'failed';
  join?: NewsletterGroupJoinStatus;
  result?: NewsletterJoinResult;
}

export interface CreateNewsletterRequest {
  subject: string;
  body_html: string;
  ed_reply_email: string;
  committee_uids: string[];
  /**
   * Optional saved schedule intent. Validated leniently (future-only) at save
   * time — arming a schedule via POST …/schedule validates the full lead/
   * horizon window separately.
   */
  scheduled_at?: string | null;
}

export interface UpdateNewsletterRequest {
  subject: string;
  body_html: string;
  ed_reply_email: string;
  committee_uids: string[];
  /**
   * Full-replace like every other field here: omitting it (or passing `null`)
   * clears a previously-saved schedule. Callers that don't want to touch the
   * schedule must always send the current value back.
   */
  scheduled_at?: string | null;
}

export interface NewsletterListItem extends Newsletter {
  // The upstream list DTO currently omits both fields (per-newsletter analytics
  // require a separate /analytics call); the list page derives the displayed
  // values client-side. Kept optional for forward-compat should upstream ever
  // inline them.
  unique_opens?: number;
  open_rate?: number;
}

export interface NewsletterListResponse {
  newsletters: NewsletterListItem[];
  next_page_token?: string;
}

/**
 * One row of the upstream committee-scoped list
 * (GET /committees/{committee_uid}/newsletters). Member-facing reduced DTO:
 * `body_html`, manager-only fields (ed_reply_email, group_id, created_by),
 * and the `committee_uids` audience list (would let a single-committee member
 * enumerate the newsletter's other committees) are deliberately absent — the
 * rendered body is fetched on demand via the project-scoped single-newsletter
 * endpoint.
 */
export interface CommitteeNewsletter {
  id: string;
  project_uid: string;
  subject: string;
  sent_at?: string;
}

export interface CommitteeNewsletterListResponse {
  newsletters: CommitteeNewsletter[];
  next_page_token?: string;
}

/**
 * Row of GET /api/newsletters/my-newsletters: a sent newsletter reachable
 * through one of the user's current committee memberships, enriched with
 * owner and immediate-parent metadata for the Me-lens list.
 */
export interface MyNewsletter extends CommitteeNewsletter {
  project_name?: string;
  project_slug?: string;
  is_foundation?: boolean;
  parent_project_uid?: string;
  parent_project_name?: string;
  parent_is_foundation?: boolean;
  /** The owning foundation: the owner itself when it is a foundation, else its parent. */
  foundation_uid?: string;
  foundation_slug?: string;
  foundation_name?: string;
  foundation_logo_url?: string | null;
}

/** Completeness concerns issue enumeration, not delivery or optional metadata. */
export interface MyNewslettersResponse {
  newsletters: MyNewsletter[];
  complete: boolean;
}

export type MyNewslettersApiResponse = MyNewslettersResponse | MyNewsletter[];

export interface CommitteeNewsletterFeedResult {
  newsletters: CommitteeNewsletter[];
  complete: boolean;
}

export interface MyNewslettersState {
  loading: boolean;
  error: boolean;
  newsletters: MyNewsletter[];
  /** Null means completeness is unavailable, including legacy array responses. */
  complete: boolean | null;
}

/**
 * `MyNewsletter` row precomputed with its permalink path, so the My
 * Newsletters list template reads `row.issuePath` instead of calling a
 * template function per row (`null` when `project_slug` failed to resolve).
 */
export interface MyNewsletterRow extends MyNewsletter {
  issuePath: string | null;
}

export interface NewsletterListParams {
  status?: NewsletterStatus;
  page_token?: string;
}

/**
 * Reason a newsletter's schedule form can't be armed. `'past'` | `'tooSoon'` |
 * `'tooFar'` come from `newsletterScheduleWindowValidator` — `'past'` is the
 * only case that should clear the picker (the value can no longer save);
 * `'tooSoon'`/`'tooFar'` still save fine and only need to disable the Schedule
 * action. `'invalidFormat'` comes from the `scheduleTime` control's own
 * `timeFormatValidator` — the time picker accepts free text, and an
 * out-of-range value like "13:99 PM" would otherwise survive into
 * `combineDateTime`, which normalizes rather than rejects overflow, silently
 * arming a different instant than the author typed.
 */
export type NewsletterScheduleWindowError = 'past' | 'tooSoon' | 'tooFar' | 'invalidFormat';

export interface NewsletterDailyOpens {
  date: string;
  opens: number;
  unique_opens: number;
}

export interface NewsletterDailyClicks {
  date: string;
  clicks: number;
  unique_clicks: number;
}

/**
 * One row of the aggregate `top_links` breakdown (lfx-v2-newsletter-service PR
 * #76). Capped upstream at the 20 highest-`clicks` URLs and already sorted by
 * `clicks` descending — clients should not re-sort. Compliance-footer links
 * (Unsubscribe, My Newsletters) are excluded upstream, so this reflects
 * author content only.
 */
export interface NewsletterLinkClicks {
  url: string;
  clicks: number;
  unique_clicks: number;
}

export interface NewsletterAnalytics {
  newsletter_id: string;
  subject: string;
  status: NewsletterStatus;
  sent_at?: string;
  total_recipients: number;
  delivered: number;
  failed: number;
  // Best-effort list of recipient addresses that failed delivery. Derived upstream from
  // per-recipient email-service status records; may lag or be shorter than `failed` (which
  // comes from the engagement rollup), and may be absent on older upstream deployments.
  failed_recipients?: string[];
  total_opens: number;
  unique_opens: number;
  open_rate: number;
  daily_opens: NewsletterDailyOpens[];
  last_event_at?: string;
  // Click metrics (lfx-v2-newsletter-service PR #76). Non-pointer upstream — always
  // present once deployed, arrays never null — but optional here so the interface
  // stays truthful against a pre-deploy newsletter-service. CRITICAL: these are
  // SendGrid-only. A newsletter sent via email-service (SES) always reports zeros /
  // empty arrays here, and `send_provider` is not exposed on any public DTO, so a
  // client cannot distinguish "clicks unmeasurable" from "zero clicks". Every click
  // UI element must therefore be gated on a single derived "has click data" rule
  // rather than rendering a misleading 0%.
  total_clicks?: number;
  unique_clicks?: number;
  /** 0-1 fraction of delivered emails (same denominator as `open_rate`); multiply by 100 for display. */
  click_rate?: number;
  /** 0-1 fraction of unique opens, clamped to 1.0 upstream; `0` when there are no opens. */
  click_to_open_rate?: number;
  daily_clicks?: NewsletterDailyClicks[];
  top_links?: NewsletterLinkClicks[];
}

/**
 * One recipient's row from the per-recipient engagement endpoint
 * (GET …/newsletters/{id}/analytics/recipients). Mirrors the upstream DTO
 * (lfx-v2-newsletter-service PR #74) field-for-field.
 */
export interface NewsletterRecipientEngagement {
  // Best-effort display name resolved from the newsletter's committees at read
  // time. Absent when the member no longer appears in the committees, has no
  // name on file, or the committee lookup failed — clients fall back to email.
  name?: string;
  email: string;
  sent_at?: string;
  delivered: boolean;
  delivered_at?: string;
  failed: boolean;
  failed_at?: string;
  opened: boolean;
  open_count: number;
  last_opened_at?: string;
  // Every recorded open timestamp, ascending. Always present (empty array when
  // the recipient never opened); capped at the 500 most recent opens.
  opened_at_list: string[];
  // Click fields (lfx-v2-newsletter-service PR #76). Same shape and 500-entry cap
  // as the open fields above. SendGrid-only: on an email-service (SES) newsletter
  // these are always `false` / `0` / omitted / `[]`. Optional for the same
  // pre-deploy-truthfulness reason as NewsletterAnalytics' click fields.
  clicked?: boolean;
  click_count?: number;
  last_clicked_at?: string;
  clicked_at_list?: string[];
}

/**
 * Body of GET …/newsletters/{id}/analytics/recipients. This endpoint is
 * PII-gated upstream (requires the `auditor` relation, fail-closed) — stricter
 * than the aggregate `/analytics` endpoint's `viewer` gate, so callers must
 * handle 403 distinctly (a user who can see NewsletterAnalytics may still lack
 * access here).
 */
export interface NewsletterRecipientEngagementResponse {
  newsletter_id: string;
  // The newsletter's send-time audience snapshot.
  total_recipients: number;
  // False when the provider returned fewer per-recipient records than
  // total_recipients — clients must treat the list as partial, not as proof
  // the absent recipients were never sent to.
  complete: boolean;
  // Sorted by email ascending; always present; no pagination (upstream returns
  // the full committee-bounded audience in one response).
  recipients: NewsletterRecipientEngagement[];
}

export type NewsletterRecipientEngagementSegment = 'opened' | 'not-opened' | 'failed';

/**
 * UI view-model row derived from NewsletterRecipientEngagement for the
 * recipient engagement table: adds the resolved display fallback and the
 * bucket used for the filter chips, keeping the template free of nested
 * ternaries.
 */
export interface NewsletterRecipientRow extends NewsletterRecipientEngagement {
  displayName: string;
  segment: NewsletterRecipientEngagementSegment;
  // Precomputed so the template never calls a component method for formatting
  // (re-runs every CD cycle) — null when there's no last_opened_at to format.
  lastOpenedRelative: string | null;
  // Click fields narrowed to required and normalized (`?? false` / `?? 0` / `?? []`)
  // at row-build time, so the template never needs optional chaining on them.
  clicked: boolean;
  click_count: number;
  clicked_at_list: string[];
  /** Mirrors `lastOpenedRelative` for `last_clicked_at`; null when absent. */
  lastClickedRelative: string | null;
}

/**
 * Filter chip key for the recipient engagement table — `'all'` plus every
 * `NewsletterRecipientEngagementSegment`, plus `'clicked'`. `'clicked'` is
 * deliberately NOT a `NewsletterRecipientEngagementSegment`: clicking is
 * orthogonal to the mutually-exclusive opened/not-opened/failed bucket (a
 * clicker is usually also an opener, and an image-blocked clicker can still be
 * 'not-opened'), so the Clicked chip's count overlaps 'Opened' and the chip
 * counts do not sum to the 'all' count.
 */
export type NewsletterRecipientEngagementChipKey = 'all' | NewsletterRecipientEngagementSegment | 'clicked';

/** One filter chip above the recipient engagement table, with its live count. */
export interface NewsletterRecipientEngagementChipConfig {
  key: NewsletterRecipientEngagementChipKey;
  label: string;
  count: number;
}

export interface NewsletterRow extends NewsletterListItem {
  openRateLabel: string;
  /** UI-populated: true while the row's analytics fetch is in flight. */
  openRatePending: boolean;
  openRateTooltip: string;
  /** UI-populated: screen-reader label combining the open-rate value and its tooltip context. */
  openRateAria: string;
  recipientsLabel: string;
  groupsLabel: string;
  /** Formatted `scheduled_at` in the viewer's local timezone, e.g. "Aug 17, 9:00 AM PDT". Empty when unset. */
  scheduledLabel: string;
  /** Longer form for a tooltip/aria-label, e.g. including "(in 2 days)". */
  scheduledTooltip: string;
  /** True for a `sending` row that carries `scheduled_at` — an arm in progress, not a send in progress. Rendered disabled ("Scheduling…"), no row actions. */
  isArming: boolean;
}

export interface NewsletterChartDataset {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor: string;
  tension: number;
  fill: boolean;
}

export interface NewsletterChartData {
  labels: string[];
  datasets: NewsletterChartDataset[];
}

/**
 * UI row for the "Top clicked links" table. `href` is the result of running
 * the untrusted upstream `url` through `normalizeToUrl`, precomputed so the
 * template neither calls a method nor re-validates on every CD cycle; `null`
 * when the URL fails validation, in which case the raw string renders as
 * unlinked text instead of an anchor.
 */
export interface NewsletterLinkRow extends NewsletterLinkClicks {
  href: string | null;
}

export interface NewsletterOptOut {
  id: string;
  email: string;
  unsubscribed_at: string;
}

export interface NewsletterOptOutListResponse {
  opt_outs: NewsletterOptOut[];
}

// Discriminates the two list shapes the newsletter list page's context/tab
// switchMap can resolve to, so a single subscribe callback can route each
// response without a second stream.
export type NewsletterListLoadResult =
  | {
      kind: 'newsletters';
      response: NewsletterListResponse;
      // Non-paginated `status=sending` rows carrying `scheduled_at` — arms in
      // progress, fetched alongside the paginated `status=scheduled` request
      // on the Scheduled tab only (see the list-filter trap in the newsletter
      // service contract). Undefined on every other tab.
      arming?: NewsletterListItem[];
    }
  | { kind: 'optout'; response: NewsletterOptOutListResponse };
