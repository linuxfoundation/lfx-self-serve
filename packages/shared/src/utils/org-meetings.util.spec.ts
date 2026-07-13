// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// org-meetings.util transitively imports the shared constants barrel, which pulls in modules that
// need the Angular JIT compiler when loaded outside an Angular bootstrap (as under Vitest). Importing
// the compiler first provides that facade so the module can be imported (see meeting.utils.spec.ts).
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import type { OrgMeetingBase } from '../interfaces';
import { splitOrgMeetingsByPrivacy } from './org-meetings.util';

/** Builds an OrgMeetingBase fixture, defaulting every field so tests set only what they assert on. */
function meeting(partial: Partial<OrgMeetingBase>): OrgMeetingBase {
  return {
    id: partial.id ?? 'meeting-1',
    title: partial.title ?? 'Untitled Meeting',
    privacy: partial.privacy ?? 'public',
    type: partial.type ?? 'other',
    recurrenceLabel: partial.recurrenceLabel ?? null,
    startTime: partial.startTime ?? '2024-01-01T00:00:00Z',
    endTime: partial.endTime ?? '2024-01-01T01:00:00Z',
    foundation: partial.foundation ?? 'CNCF',
    orgName: partial.orgName ?? 'Acme',
    project: partial.project ?? 'Kubernetes',
    agenda: partial.agenda ?? null,
    resources: partial.resources ?? [],
  };
}

const noInvitees = () => [] as readonly string[];

describe('splitOrgMeetingsByPrivacy', () => {
  it('treats every public meeting as visible with no rollup', () => {
    const meetings = [meeting({ id: 'meeting-1', privacy: 'public' }), meeting({ id: 'meeting-2', privacy: 'public' })];

    const result = splitOrgMeetingsByPrivacy(meetings, noInvitees);

    expect(result.visible).toEqual(meetings);
    expect(result.rollup).toBeNull();
  });

  it('keeps a private meeting visible when the demo viewer-invited hash resolves truthy and it has named invitees', () => {
    // deriveDemoViewerInvited only ever grants invited status to demo-prefixed ids (um-/pm-); um-2
    // hashes to a non-zero mod-3 bucket, so the viewer is treated as invited — but "invited" also
    // requires at least one named invitee, since a real (non-demo) private meeting always arrives
    // with an empty invitee list (server-redacted) and must never be treated as visible.
    const invited = meeting({ id: 'um-2', privacy: 'private' });

    const result = splitOrgMeetingsByPrivacy([invited], () => ['Ada Lovelace']);

    expect(result.visible).toEqual([invited]);
    expect(result.rollup).toBeNull();
  });

  it('collapses a private meeting into the rollup even when the demo viewer-invited hash resolves truthy if it has no named invitees', () => {
    // Guards against treating an id-prefix hash alone as an access-control signal — a real API-backed
    // private meeting could theoretically collide with the um-/pm- demo prefix, but it always arrives
    // with orgInvitees redacted to `[]`, so it must stay hidden regardless of the hash outcome.
    const invited = meeting({ id: 'um-2', privacy: 'private' });

    const result = splitOrgMeetingsByPrivacy([invited], noInvitees);

    expect(result.visible).toEqual([]);
    expect(result.rollup?.totalCount).toBe(1);
  });

  it('collapses a private meeting into the rollup when the demo viewer-invited hash resolves falsy', () => {
    // um-1 hashes to mod-3 === 0, so deriveDemoViewerInvited treats the viewer as not invited.
    const hidden = meeting({ id: 'um-1', privacy: 'private', type: 'board', project: 'Envoy', foundation: 'CNCF' });

    const result = splitOrgMeetingsByPrivacy([hidden], noInvitees);

    expect(result.visible).toEqual([]);
    expect(result.rollup).not.toBeNull();
    expect(result.rollup?.totalCount).toBe(1);
    expect(result.rollup?.projectCount).toBe(1);
    expect(result.rollup?.foundationCount).toBe(1);
    expect(result.rollup?.typeBadges.map((b) => b.type)).toEqual(['board']);
    expect(result.rollup?.typeBadges[0]?.count).toBe(1);
  });

  it('aggregates type counts, distinct projects/foundations, and deduped employee names across hidden meetings', () => {
    const hiddenBoard = meeting({ id: 'meeting-3', privacy: 'private', type: 'board', project: 'Envoy', foundation: 'CNCF' });
    const hiddenBoardAgain = meeting({ id: 'meeting-6', privacy: 'private', type: 'board', project: 'Envoy', foundation: 'CNCF' });
    const hiddenMarketing = meeting({ id: 'meeting-9', privacy: 'private', type: 'marketing', project: 'Fluentd', foundation: 'LF AI' });
    const visiblePublic = meeting({ id: 'meeting-1', privacy: 'public', type: 'other' });

    const inviteesByMeetingId: Record<string, readonly string[]> = {
      'meeting-3': ['Ada Lovelace', 'Bob Brown'],
      'meeting-6': ['Ada Lovelace'], // Same invitee as meeting-3 — should not be double-counted.
      'meeting-9': ['Cara Chen'],
    };

    const result = splitOrgMeetingsByPrivacy([hiddenBoard, hiddenBoardAgain, hiddenMarketing, visiblePublic], (m) => inviteesByMeetingId[m.id] ?? []);

    expect(result.visible).toEqual([visiblePublic]);
    expect(result.rollup?.totalCount).toBe(3);
    expect(result.rollup?.projectCount).toBe(2); // Envoy, Fluentd
    expect(result.rollup?.foundationCount).toBe(2); // CNCF, LF AI
    expect(result.rollup?.employeeCount).toBe(3); // Ada, Bob, Cara — deduped by name

    const typeBadgesByType = new Map(result.rollup?.typeBadges.map((b) => [b.type, b.count]));
    expect(typeBadgesByType.get('board')).toBe(2);
    expect(typeBadgesByType.get('marketing')).toBe(1);
  });

  it('falls back to an anonymous invitee count when a hidden meeting has no invitee names', () => {
    // Mirrors a real (non-demo) private meeting whose orgInvitees were redacted server-side to `[]` —
    // the rollup should still report a non-zero employeeCount via the RSVP/attendance tally fallback.
    const redactedPrivate = meeting({ id: 'meeting-42', privacy: 'private', type: 'board' });
    const namedPrivate = meeting({ id: 'meeting-43', privacy: 'private', type: 'board' });

    const result = splitOrgMeetingsByPrivacy(
      [redactedPrivate, namedPrivate],
      (m) => (m.id === 'meeting-43' ? ['Dana Diaz'] : []),
      (m) => (m.id === 'meeting-42' ? 5 : 0)
    );

    expect(result.rollup?.employeeCount).toBe(6); // 5 anonymous + Dana Diaz
  });

  it('orders rollup type badges by the ORG_MEETING_TYPE_LABELS key order, not insertion order', () => {
    const hiddenOther = meeting({ id: 'meeting-9', privacy: 'private', type: 'other' });
    const hiddenBoard = meeting({ id: 'meeting-3', privacy: 'private', type: 'board' });

    const result = splitOrgMeetingsByPrivacy([hiddenOther, hiddenBoard], noInvitees);

    expect(result.rollup?.typeBadges.map((b) => b.type)).toEqual(['board', 'other']);
  });
});
