// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

export interface EnrollmentMembership {
  Status: 'Active' | 'Purchased' | 'Expired';
  AutoRenew: boolean;
  PurchaseDate: string;
  EndDate: string;
  Price: number;
  ID: string;
  ExtPaymentType: string;
}

export interface IndividualEnrollment {
  projectName: string;
  projectSlug: string;
  ProductName: string;
  projectDesc: string;
  enrollButton: string;
  price?: number;
  projectLogo: string;
  benefits: string[];
  projectId: string;
  productSFID: string;
  productId: string;
  membership: EnrollmentMembership | null;
  ctaPath: string;
  activeButtonText: string;
  activeButtonURL: string;
}

export interface UpdateAutoRenewRequest {
  autorenew: boolean;
}

export type EnrollmentDisplayStatus = 'Active' | 'Expiring Soon' | 'Expired' | 'Not Enrolled';

export interface RawMembership {
  Status?: string;
  AutoRenew?: boolean;
  PurchaseDate?: string;
  EndDate?: string;
  Price?: number;
  ID?: string;
  ExtPaymentID?: string;
  Product?: { ID?: string };
}

export interface DisplayEnrollment extends IndividualEnrollment {
  displayStatus: EnrollmentDisplayStatus;
  severity: 'success' | 'warn' | 'danger' | 'secondary';
  enrollHref: string;
  renewHref: string;
}

export type EnrollmentsState = { kind: 'loading' } | { kind: 'loaded'; items: IndividualEnrollment[] } | { kind: 'error'; message: string };
