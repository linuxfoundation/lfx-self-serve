// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { EnrollmentDisplayStatus, IndividualEnrollment } from '../interfaces/enrollment.interface';

// Status derivation mirrors enrollment.plugin.js:197–226 from myprofile, with one intentional
// divergence: the Stripe auto-renew short-circuit below is guarded by EndDate.
export function deriveEnrollmentStatus(item: IndividualEnrollment): EnrollmentDisplayStatus {
  const { membership, price } = item;
  if (!membership) return 'Not Enrolled';
  if (membership.Status === 'Expired') return 'Expired';
  if (price === null || price === undefined) return 'Active';
  const endDateString = membership.EndDate.length >= 10 ? membership.EndDate.slice(0, 10) : membership.EndDate;
  let endDate: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDateString)) {
    const [y, m, d] = endDateString.split('-').map(Number);
    endDate = new Date(Date.UTC(y, m - 1, d));
  } else {
    endDate = new Date(membership.EndDate);
  }
  const now = new Date();
  const isExpired = endDate < now;
  // Stripe auto-renewing memberships renew before expiry, so keep them "Active" (suppressing
  // "Expiring Soon") WHILE STILL CURRENT. Guard on !isExpired so a lapsed subscription (failed
  // charge / paused) whose Status upstream hasn't flipped to Expired falls through to the date
  // logic below instead of falsely showing Active.
  if (membership.AutoRenew && membership.ExtPaymentType === 'stripe' && !isExpired) return 'Active';
  if (isExpired) return 'Expired';
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (endDate < thirtyDaysFromNow) return 'Expiring Soon';
  return 'Active';
}

export function enrollmentStatusSeverity(status: EnrollmentDisplayStatus): 'success' | 'warn' | 'danger' | 'secondary' {
  switch (status) {
    case 'Active':
      return 'success';
    case 'Expiring Soon':
      return 'warn';
    case 'Expired':
      return 'danger';
    default:
      return 'secondary';
  }
}
