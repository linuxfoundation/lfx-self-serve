// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { projectUidFromUrl } from './newsletter-access.guard';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

// Each case is named rather than table-driven so a failure says WHICH class
// of input stopped resolving (or started resolving something it shouldn't) —
// see the same rationale in http-error.utils.spec.ts. This function feeds
// newsletterAccessGuard's authorization decision directly, and every case
// below corresponds to a real navigated URL from one of the newsletters
// mounts in app.routes.ts / newsletters.routes.ts.
describe('projectUidFromUrl', () => {
  it('recovers the UID from the foundation-lens editions mount', () => {
    expect(projectUidFromUrl(`/foundation/newsletters/${UUID_A}/pub-1/editions`)).toBe(UUID_A);
  });

  it('recovers the UID from the project-lens edit mount', () => {
    expect(projectUidFromUrl(`/project/newsletters/${UUID_A}/nl-1/edit`)).toBe(UUID_A);
  });

  it('recovers the UID from the flat (me/org-lens) analytics mount', () => {
    expect(projectUidFromUrl(`/newsletters/${UUID_A}/nl-1/analytics`)).toBe(UUID_A);
  });

  it('stops the capture at a matrix param', () => {
    expect(projectUidFromUrl(`/newsletters/${UUID_A};foo=bar/pub-1/editions`)).toBe(UUID_A);
  });

  it('returns null for the bare publications-list route', () => {
    expect(projectUidFromUrl('/foundation/newsletters')).toBeNull();
  });

  it('does not mistake the "list" route for a project UID', () => {
    expect(projectUidFromUrl('/project/newsletters/list')).toBeNull();
  });

  it('does not mistake the "create" route for a project UID', () => {
    expect(projectUidFromUrl('/newsletters/create')).toBeNull();
  });

  it('does not mistake the "my" route for a project UID', () => {
    expect(projectUidFromUrl('/newsletters/my')).toBeNull();
  });

  it('ignores a UID-shaped value appearing only in the query string', () => {
    // The real project (UUID_A) lives in the path; an unrelated query value
    // (UUID_B) must never outrank it or be picked up on its own.
    expect(projectUidFromUrl(`/foundation/newsletters/list?x=/newsletters/${UUID_B}`)).toBeNull();
  });

  it('ignores a UID-shaped value appearing only in the fragment', () => {
    expect(projectUidFromUrl(`/foundation/newsletters/list#/newsletters/${UUID_B}`)).toBeNull();
  });

  it('does not match a UID embedded in an unrelated route', () => {
    expect(projectUidFromUrl(`/foundation/overview?redirect=/newsletters/${UUID_B}`)).toBeNull();
  });

  it('does not match the reader permalink mount, which never applies this guard', () => {
    expect(projectUidFromUrl(`/newsletters/some-project-slug/${UUID_A}`)).toBeNull();
  });

  it('returns null for a non-UUID segment even when it looks path-shaped', () => {
    expect(projectUidFromUrl('/newsletters/not-a-real-uid/pub-1/editions')).toBeNull();
  });
});
