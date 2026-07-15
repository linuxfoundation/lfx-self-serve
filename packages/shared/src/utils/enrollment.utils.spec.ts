// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for individual-enrollment status derivation.
//
// All fixtures use synthetic placeholder data — never real user data.

import { describe, expect, it } from 'vitest';

import { EnrollmentMembership, IndividualEnrollment } from '../interfaces';
import { deriveEnrollmentStatus, enrollmentStatusSeverity } from './enrollment.utils';

/** Formats a Date as YYYY-MM-DD, matching the EndDate shape the member-service returns. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const now = new Date();
const daysFromNow = (days: number): string => isoDate(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));

/** Minimal membership builder — only the fields the resolver reads. */
function membership(overrides: Partial<EnrollmentMembership> = {}): EnrollmentMembership {
  return {
    Status: 'Active',
    AutoRenew: false,
    PurchaseDate: daysFromNow(-365),
    EndDate: daysFromNow(60),
    Price: 100,
    ID: 'mem-1',
    ExtPaymentType: '',
    ...overrides,
  };
}

/** Minimal enrollment builder — only the fields the resolver reads. */
function enrollment(overrides: Partial<IndividualEnrollment> = {}): IndividualEnrollment {
  return {
    projectName: 'Example Project',
    projectSlug: 'example-project',
    ProductName: 'Individual Supporter',
    projectDesc: '',
    enrollButton: 'Enroll',
    price: 100,
    projectLogo: '',
    benefits: [],
    projectId: 'proj-1',
    productSFID: 'sfid-1',
    productId: 'prod-1',
    membership: membership(),
    ctaPath: '',
    activeButtonText: '',
    activeButtonURL: '',
    ...overrides,
  };
}

describe('deriveEnrollmentStatus', () => {
  it('returns Not Enrolled when there is no membership', () => {
    expect(deriveEnrollmentStatus(enrollment({ membership: null }))).toBe('Not Enrolled');
  });

  it('returns Expired when Status is Expired, even for stripe + autoRenew', () => {
    const item = enrollment({ membership: membership({ Status: 'Expired', AutoRenew: true, ExtPaymentType: 'stripe', EndDate: daysFromNow(60) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Expired');
  });

  it('returns Active for a free-tier item (no price) regardless of EndDate', () => {
    const item = enrollment({ price: undefined, membership: membership({ EndDate: daysFromNow(-10) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Active');
  });

  it('returns Active for stripe + autoRenew with a future EndDate', () => {
    const item = enrollment({ membership: membership({ AutoRenew: true, ExtPaymentType: 'stripe', EndDate: daysFromNow(60) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Active');
  });

  it('suppresses Expiring Soon for stripe + autoRenew within the 30-day window', () => {
    const item = enrollment({ membership: membership({ AutoRenew: true, ExtPaymentType: 'stripe', EndDate: daysFromNow(10) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Active');
  });

  it('returns Expired for stripe + autoRenew with a past EndDate (regression guard)', () => {
    const item = enrollment({ membership: membership({ AutoRenew: true, ExtPaymentType: 'stripe', EndDate: daysFromNow(-5) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Expired');
  });

  it('returns Expired for a non-stripe membership with a past EndDate', () => {
    const item = enrollment({ membership: membership({ AutoRenew: false, ExtPaymentType: 'paypal', EndDate: daysFromNow(-5) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Expired');
  });

  it('returns Active when EndDate is more than 30 days out', () => {
    const item = enrollment({ membership: membership({ EndDate: daysFromNow(60) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Active');
  });

  it('returns Expiring Soon when EndDate is within 30 days and not stripe-autoRenew', () => {
    const item = enrollment({ membership: membership({ EndDate: daysFromNow(10) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Expiring Soon');
  });
});

describe('enrollmentStatusSeverity', () => {
  it('maps Active to success', () => {
    expect(enrollmentStatusSeverity('Active')).toBe('success');
  });

  it('maps Expiring Soon to warn', () => {
    expect(enrollmentStatusSeverity('Expiring Soon')).toBe('warn');
  });

  it('maps Expired to danger', () => {
    expect(enrollmentStatusSeverity('Expired')).toBe('danger');
  });

  it('maps Not Enrolled to secondary', () => {
    expect(enrollmentStatusSeverity('Not Enrolled')).toBe('secondary');
  });
});
