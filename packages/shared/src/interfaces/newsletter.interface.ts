// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type NewsletterContextType = 'foundation' | 'project';

export type NewsletterStatusTabId = 'draft' | 'sent';

export interface NewsletterCommitteeOption {
  label: string;
  value: string;
  category: string;
}

export interface NewsletterRecipientCountPayload {
  committeeUids: string[];
}

export interface NewsletterRecipientCount {
  count: number;
}

export interface NewsletterRecipient {
  email: string;
  firstName?: string;
}

export interface NewsletterRecipientsResponse {
  recipients: NewsletterRecipient[];
}

export interface NewsletterTestSendPayload {
  subject: string;
  bodyHtml: string;
  toEmail: string;
  contextType: NewsletterContextType;
  contextUid: string;
  edReplyEmail: string;
}

export interface NewsletterSendPayload {
  subject: string;
  bodyHtml: string;
  committeeUids: string[];
  contextType: NewsletterContextType;
  contextUid: string;
  edReplyEmail: string;
}

export interface NewsletterSendFailure {
  email: string;
  reason: string;
}

export interface NewsletterSendResult {
  totalRecipients: number;
  sent: number;
  failed: number;
  failures: NewsletterSendFailure[];
  groupId: string;
  /**
   * True when emails were delivered to the email-service but the follow-up
   * PATCH to flip the newsletter to `status='sent'` exhausted its retries.
   * The send succeeded — recipients received emails — but the newsletter row
   * still reads as a draft. The frontend should surface this distinctly from
   * a delivery failure so operators don't retry and cause duplicate sends.
   */
  markSentFailed?: boolean;
}

export type NewsletterStatus = 'draft' | 'sent';

export interface Newsletter {
  id: string;
  contextType: NewsletterContextType;
  contextUid: string;
  subject: string;
  bodyHtml: string;
  edReplyEmail: string;
  committeeUids: string[];
  status: NewsletterStatus;
  sentAt?: string;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Set at first send (UUID minted in Express, persisted via the Go newsletter
  // service). Used to query engagement analytics from lfx-v2-email-service.
  groupId?: string;
}

export interface CreateNewsletterDraftRequest {
  contextType: NewsletterContextType;
  contextUid: string;
  subject: string;
  bodyHtml: string;
  edReplyEmail: string;
  committeeUids: string[];
}

export interface UpdateNewsletterDraftRequest {
  subject: string;
  bodyHtml: string;
  edReplyEmail: string;
  committeeUids: string[];
}

export interface NewsletterDraftListResponse {
  drafts: Newsletter[];
}

export interface NewsletterListItem extends Newsletter {
  totalRecipients?: number;
  uniqueOpens?: number;
  openRate?: number;
}

export interface NewsletterListResponse {
  newsletters: NewsletterListItem[];
  nextPageToken?: string;
}

export interface NewsletterListParams {
  contextType: NewsletterContextType;
  contextUid: string;
  status?: NewsletterStatus;
  pageToken?: string;
}

export interface NewsletterDailyOpens {
  date: string;
  opens: number;
  uniqueOpens: number;
}

export interface NewsletterAnalytics {
  newsletterId: string;
  subject: string;
  status: NewsletterStatus;
  sentAt?: string;
  totalRecipients: number;
  delivered: number;
  failed: number;
  totalOpens: number;
  uniqueOpens: number;
  openRate: number;
  dailyOpens: NewsletterDailyOpens[];
  lastEventAt?: string;
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
