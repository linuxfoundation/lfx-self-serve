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
  reason?: string;
  created_at: string;
  updated_at?: string;
}

/**
 * Request payload to create a committee join application
 */
export interface CreateCommitteeJoinApplicationRequest {
  reason?: string;
}
