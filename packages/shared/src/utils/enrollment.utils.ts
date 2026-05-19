// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { parseLocalDateString } from './date-time.utils';
import { EnrollmentDisplayStatus, IndividualEnrollment } from '../interfaces/enrollment.interface';

// Status derivation mirrors enrollment.plugin.js:197–226 from myprofile
export function deriveEnrollmentStatus(item: IndividualEnrollment): EnrollmentDisplayStatus {
  const { membership, price } = item;
  if (!membership) return 'Not Enrolled';
  if (membership.Status === 'Expired') return 'Expired';
  if (price === null || price === undefined) return 'Active';
  if (membership.AutoRenew && membership.ExtPaymentType === 'stripe') return 'Active';
  const endDateString = membership.EndDate.length >= 10 ? membership.EndDate.slice(0, 10) : membership.EndDate;
  let endDate: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDateString)) {
    try {
      endDate = parseLocalDateString(endDateString);
    } catch {
      endDate = new Date(membership.EndDate);
    }
  } else {
    endDate = new Date(membership.EndDate);
  }
  const now = new Date();
  if (endDate < now) return 'Expired';
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
