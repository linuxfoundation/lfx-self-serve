// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

export interface EnrollmentMembership {
  status: 'Active' | 'Purchased' | 'Expired';
  autoRenew: boolean;
  purchaseDate: string;
  endDate: string;
  price: number;
  id: string;
  extPaymentType: string;
}

export interface IndividualEnrollment {
  projectName: string;
  projectSlug: string;
  productName: string;
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
  /** True while an auto-renew PATCH is in flight for this enrollment's membership. */
  pending: boolean;
}

// One state machine (loading | loaded | error) reused for both the raw server items and the
// component's display projection, so the two variants can't drift apart.
export type EnrollmentsStateOf<T> = { kind: 'loading' } | { kind: 'loaded'; items: T[] } | { kind: 'error'; message: string };
export type EnrollmentsState = EnrollmentsStateOf<IndividualEnrollment>;
export type DisplayEnrollmentsState = EnrollmentsStateOf<DisplayEnrollment>;
