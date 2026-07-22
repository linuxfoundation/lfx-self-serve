// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for individual-enrollment status derivation.
//
// All fixtures use synthetic placeholder data — never real user data.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EnrollmentMembership, IndividualEnrollment } from '../interfaces';
import { deriveEnrollmentStatus, enrollmentStatusSeverity } from './enrollment.utils';

/** Formats a Date as YYYY-MM-DD, matching the EndDate shape the member-service returns. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Freeze the clock so fixture dates (computed here) and the resolver's own `new Date()` calls
// always agree — otherwise a UTC-midnight crossing between fixture setup and assertion could
// flip the day-boundary tests below nondeterministically.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

const daysFromNow = (days: number): string => isoDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

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

  it('returns Active for a free-tier item (price null) regardless of EndDate', () => {
    // `price` is typed as `number | undefined`, but the resolver also guards against a runtime
    // `null` — cast through `number` (not `undefined`) so the test doesn't misrepresent the value
    // it's actually passing.
    const item = enrollment({ price: null as unknown as number, membership: membership({ EndDate: daysFromNow(-10) }) });
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

  it('returns Expiring Soon when EndDate lands exactly on the 30-day mark', () => {
    // EndDate is normalized to UTC midnight while `now` (and the 30-day cutoff derived from it)
    // carries a time-of-day, so midnight-of-day+30 is still strictly less than now+30d.
    const item = enrollment({ membership: membership({ EndDate: daysFromNow(30) }) });
    expect(deriveEnrollmentStatus(item)).toBe('Expiring Soon');
  });

  it('returns Active when EndDate is 31 days out (first day fully outside the window)', () => {
    const item = enrollment({ membership: membership({ EndDate: daysFromNow(31) }) });
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
