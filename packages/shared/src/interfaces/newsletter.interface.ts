// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
 * project metadata for the Me-lens list (same enrichment fields as my-votes).
 */
export interface MyNewsletter extends CommitteeNewsletter {
  project_name?: string;
  project_slug?: string;
  is_foundation?: boolean;
  parent_project_uid?: string;
}

export interface NewsletterListParams {
  status?: NewsletterStatus;
  page_token?: string;
}

/**
 * Reason a newsletter's schedule form can't be armed, as reported by
 * `newsletterScheduleWindowValidator` — `'past'` is the only case that should
 * clear the picker (the value can no longer save); `'tooSoon'`/`'tooFar'`
 * still save fine and only need to disable the Schedule action.
 */
export type NewsletterScheduleWindowError = 'past' | 'tooSoon' | 'tooFar';

export interface NewsletterDailyOpens {
  date: string;
  opens: number;
  unique_opens: number;
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
}

/** Filter chip key for the recipient engagement table — `'all'` plus every `NewsletterRecipientEngagementSegment`. */
export type NewsletterRecipientEngagementChipKey = 'all' | NewsletterRecipientEngagementSegment;

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
