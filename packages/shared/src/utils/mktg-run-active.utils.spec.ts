// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { readMktgActiveRunConflict, mktgActiveRunConflictHeading } from './mktg-run-active.utils';

const body = {
  code: 'MKTG_RUN_ACTIVE',
  message: 'A run is in progress.',
  startedBy: 'Synthetic writer',
  startedByViewer: false,
  startedAt: '2026-10-19T12:00:00.000Z',
  activeRunId: 'b'.repeat(64),
  state: 'writing',
  agentKey: 'brand-kit',
  documentId: 'living',
};

describe('active-run conflict choices', () => {
  it('accepts the actual top-level error response and ignores unrelated error metadata', () => {
    const conflict = readMktgActiveRunConflict({ ...body, error: body.message, service: 'object_store', path: '/api/synthetic' }, 'brand-kit');
    expect(conflict).toEqual(body);
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe("Synthetic writer's Brand Kit run is in progress");
  });
  it.each([true, false])('uses viewer ownership for a living FAQ heading (own=%s)', (startedByViewer) => {
    const conflict = readMktgActiveRunConflict({ ...body, agentKey: 'faq', startedByViewer }, 'faq');
    expect(conflict).not.toBeNull();
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe(
      startedByViewer ? 'Your FAQ run is in progress' : "Synthetic writer's FAQ run is in progress"
    );
  });
  it.each([
    { code: 'OTHER' },
    { state: 'failed' },
    { activeRunId: '../unsafe' },
    { documentId: 'run-' + 'a'.repeat(24) },
    { agentKey: 'faq' },
    { startedBy: '' },
    { startedBy: null },
    { startedByViewer: undefined },
    { startedByViewer: 'true' },
    { startedAt: undefined },
    { startedAt: 'invalid' },
  ])('rejects malformed or out-of-slot facts %j', (override) => {
    expect(readMktgActiveRunConflict({ ...body, ...override }, 'brand-kit')).toBeNull();
  });
  it.each([
    ['linkedin-post', 'LinkedIn post'],
    ['member-360', 'Member 360'],
  ])('uses the exact one-off %s title, without a doubled run suffix', (agentKey, label) => {
    const conflict = readMktgActiveRunConflict({ ...body, agentKey, documentId: 'run-' + 'a'.repeat(24) }, agentKey);
    expect(conflict).not.toBeNull();
    expect(conflict && mktgActiveRunConflictHeading(conflict)).toBe(`Your ${label} run is in progress`);
    expect(readMktgActiveRunConflict({ ...body, agentKey }, agentKey)).toBeNull();
  });
});
