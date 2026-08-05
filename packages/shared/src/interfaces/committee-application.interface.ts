// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Status of a committee join application
 */
export type CommitteeJoinApplicationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Represents a join application for a committee
 */
export interface CommitteeJoinApplication {
  uid: string;
  committee_uid: string;
  applicant_email: string;
  applicant_name?: string;
  applicant_uid?: string;
  status: CommitteeJoinApplicationStatus;
  /** Application message from the applicant */
  message?: string;
  /** Notes left by the reviewer on approve/reject */
  reviewer_notes?: string;
  reason?: string;
  created_at: string;
  updated_at?: string;
}

/** Request payload to approve a committee join application */
export interface ApproveCommitteeJoinApplicationRequest {
  reviewer_notes?: string;
  /** When true, send an acceptance email to the applicant. Defaults to true from the BFF. */
  notify?: boolean;
}

/** Request payload to reject a committee join application */
export interface RejectCommitteeJoinApplicationRequest {
  reviewer_notes?: string;
  /** When true, send a rejection email to the applicant. Defaults to true from the BFF. */
  notify?: boolean;
}

/**
 * Request payload to create a committee join application
 */
export interface CreateCommitteeJoinApplicationRequest {
  /** Message from the applicant (max 2000 chars) */
  message: string;
}
