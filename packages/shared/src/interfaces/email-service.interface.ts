// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Contracts for the lfx-v2-email-service NATS subjects.
 *
 * Subjects:
 *   lfx.email-service.send_email
 *   lfx.email-service.get_email_status
 *   lfx.email-service.get_email_engagement_analytics
 *
 * See: https://github.com/linuxfoundation/lfx-v2-email-service
 */

export interface EmailServiceSendRequest {
  to: string;
  subject: string;
  html: string;
  text: string;
  group_id?: string;
}

export interface EmailServiceSendResponse {
  email_id: string;
  group_id: string;
}

export interface OpenEvent {
  /** SNS MessageId used by the email-service to dedupe replayed SES events. */
  event_id: string;
  /** SES-provided open timestamp. */
  opened_at: string;
}

export interface EmailRecipientRecord {
  email_id: string;
  group_id: string;
  to: string;
  subject: string;
  sent_at: string;
  delivered: boolean;
  delivered_at?: string;
  /** True if the recipient opened the email at least once. */
  opened: boolean;
  /**
   * Every unique open event for this recipient, keyed server-side by
   * SNS MessageId for dedup. Absent (not present in JSON) when the
   * recipient has never opened — upstream serializes with `omitempty`.
   * Equivalent to `open_count === (opened_at_list?.length ?? 0)`.
   */
  opened_at_list?: OpenEvent[];
  /** Total number of times the email was opened (== opened_at_list.length). */
  open_count: number;
  /** Most recent open timestamp; the server only advances this forward. */
  last_opened_at?: string;
  failed: boolean;
}

export interface EmailServiceStatusByEmailRequest {
  email_id: string;
}

export interface EmailServiceStatusByGroupRequest {
  group_id: string;
}

export interface EmailServiceEngagementResponse {
  group_id: string;
  total_sent: number;
  delivered: number;
  /** Total opens across the group — includes repeat opens by the same recipient. */
  opened: number;
  /** Count of distinct recipients in the group who opened at least once. */
  unique_opened: number;
  failed: number;
}

export interface EmailServiceErrorResponse {
  error: string;
}
