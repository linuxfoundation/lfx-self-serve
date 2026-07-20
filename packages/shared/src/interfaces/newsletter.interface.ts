// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type NewsletterStatusTabId = 'draft' | 'sent' | 'optout';

/**
 * Newsletter lifecycle states.
 *
 * `sending` is the transient state between the newsletter-service accepting a
 * send (202) and the background fan-out settling — to `sent` on completion, or
 * back to `draft` when zero recipients could be delivered to. The upstream
 * `status=sent` list filter also matches `sending` rows, so in-flight sends
 * appear on the Sent tab.
 */
export type NewsletterStatus = 'draft' | 'sending' | 'sent';

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

export interface Newsletter {
  id: string;
  project_uid: string;
  subject: string;
  body_html: string;
  ed_reply_email: string;
  committee_uids: string[];
  status: NewsletterStatus;
  sent_at?: string;
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
}

export interface UpdateNewsletterRequest {
  subject: string;
  body_html: string;
  ed_reply_email: string;
  committee_uids: string[];
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

export interface NewsletterListParams {
  status?: NewsletterStatus;
  page_token?: string;
}

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

export interface NewsletterRow extends NewsletterListItem {
  openRateLabel: string;
  /** UI-populated: true while the row's analytics fetch is in flight. */
  openRatePending: boolean;
  openRateTooltip: string;
  /** UI-populated: screen-reader label combining the open-rate value and its tooltip context. */
  openRateAria: string;
  recipientsLabel: string;
  groupsLabel: string;
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
  email: string;
  unsubscribed_at: string;
}

export interface NewsletterOptOutListResponse {
  opt_outs: NewsletterOptOut[];
}
