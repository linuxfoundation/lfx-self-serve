// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type NewsletterStatusTabId = 'draft' | 'sent';

export type NewsletterStatus = 'draft' | 'sent';

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
  total_opens: number;
  unique_opens: number;
  open_rate: number;
  daily_opens: NewsletterDailyOpens[];
  last_event_at?: string;
}

export interface NewsletterRow extends NewsletterListItem {
  openRateLabel: string;
  openRateTooltip: string;
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
