// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectStage } from '../enums/project-stage.enum';
import type { FormationActivity } from '../interfaces/formation.interface';
import {
  buildFormationItemDeepLinkUrl,
  buildFormationItemOwnerMailto,
  deriveFormationEntityType,
  formatFormationOwnerTeam,
  getFormationActivityDisplay,
  getFormationQueueStageDisplay,
  isFormationLifecycleLive,
  normalizeFormationActivityAction,
  normalizeFormationItemAudience,
  normalizeFormationLifecycle,
  normalizeFormationSubStage,
} from './formation.utils';

describe('deriveFormationEntityType', () => {
  it('derives foundation when is_foundation is true, regardless of parent_uid', () => {
    expect(deriveFormationEntityType({ is_foundation: true, parent_uid: null })).toBe('foundation');
    expect(deriveFormationEntityType({ is_foundation: true, parent_uid: 'some-parent-uid' })).toBe('foundation');
  });

  it('derives project when not a foundation and parent_uid is null (top-level)', () => {
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: null })).toBe('project');
  });

  it('derives project for every other falsy parent_uid form, not just null', () => {
    // Deliberately falsy, not `=== null`: a producer that omits the key (`undefined`) or sends
    // an un-collapsed empty string is the more likely deviation from the `null` contract than a
    // real ROOT UUID, and must not silently mislabel a top-level project as `child_project`.
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: undefined })).toBe('project');
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: '' })).toBe('project');
  });

  it('derives child_project when not a foundation and parent_uid names a real parent', () => {
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: 'cncf-uid' })).toBe('child_project');
  });
});

describe('normalizeFormationSubStage (GH-2366)', () => {
  it('maps the three Formation sub-stages the queue taxonomy recognizes', () => {
    expect(normalizeFormationSubStage(ProjectStage.FormationExploratory)).toBe('exploratory');
    expect(normalizeFormationSubStage(ProjectStage.FormationEngaged)).toBe('engaged');
    expect(normalizeFormationSubStage(ProjectStage.FormationOnHold)).toBe('on_hold');
  });

  it('normalizes every other ProjectStage value to null — no queue-taxonomy equivalent', () => {
    expect(normalizeFormationSubStage(ProjectStage.FormationDisengaged)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.FormationConfidential)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Active)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Archived)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Prospect)).toBeNull();
  });

  it('normalizes null/undefined/empty string to null', () => {
    expect(normalizeFormationSubStage(null)).toBeNull();
    expect(normalizeFormationSubStage(undefined)).toBeNull();
    expect(normalizeFormationSubStage('')).toBeNull();
  });

  it('normalizes an unrecognized string to null rather than throwing', () => {
    expect(normalizeFormationSubStage('not-a-real-stage')).toBeNull();
  });

  it('never resolves an Object.prototype member name off the prototype chain', () => {
    expect(normalizeFormationSubStage('toString')).toBeNull();
    expect(normalizeFormationSubStage('constructor')).toBeNull();
    expect(normalizeFormationSubStage('hasOwnProperty')).toBeNull();
  });
});

describe('normalizeFormationLifecycle (GH-2328)', () => {
  it('maps the 3 known upstream lifecycle values through unchanged', () => {
    expect(normalizeFormationLifecycle('live')).toBe('live');
    expect(normalizeFormationLifecycle('completed')).toBe('completed');
    expect(normalizeFormationLifecycle('frozen')).toBe('frozen');
  });

  it('normalizes null/undefined/empty string to null', () => {
    expect(normalizeFormationLifecycle(null)).toBeNull();
    expect(normalizeFormationLifecycle(undefined)).toBeNull();
    expect(normalizeFormationLifecycle('')).toBeNull();
  });

  // The single most important case in this file: fail-closed, not fail-open. A 4th value upstream
  // has never shipped before must resolve to `null` (read-only), never fall through to `'live'`.
  it('normalizes an invented 4th upstream value to null, never to live', () => {
    expect(normalizeFormationLifecycle('archived')).toBeNull();
  });

  it('never resolves an Object.prototype member name off the prototype chain', () => {
    expect(normalizeFormationLifecycle('toString')).toBeNull();
    expect(normalizeFormationLifecycle('constructor')).toBeNull();
    expect(normalizeFormationLifecycle('hasOwnProperty')).toBeNull();
  });
});

describe('normalizeFormationItemAudience (#2689)', () => {
  it('maps each canonical member through verbatim', () => {
    expect(normalizeFormationItemAudience('internal')).toBe('internal');
    expect(normalizeFormationItemAudience('external')).toBe('external');
    expect(normalizeFormationItemAudience('both')).toBe('both');
  });

  it('returns null for null/undefined/empty', () => {
    expect(normalizeFormationItemAudience(null)).toBeNull();
    expect(normalizeFormationItemAudience(undefined)).toBeNull();
    expect(normalizeFormationItemAudience('')).toBeNull();
  });

  // Tolerant, unlike lifecycle: an off-taxonomy value only hides a display chip, so it maps to
  // null rather than failing anything. 'manual' is the real off-taxonomy value old fixtures carried.
  it('returns null for an off-taxonomy value', () => {
    expect(normalizeFormationItemAudience('manual')).toBeNull();
    expect(normalizeFormationItemAudience('constructor')).toBeNull();
  });
});

describe('formatFormationOwnerTeam (#2689)', () => {
  it('resolves curated members through the label map', () => {
    expect(formatFormationOwnerTeam('brand_counsel')).toBe('Brand Counsel');
    expect(formatFormationOwnerTeam('product_ops')).toBe('Product Ops');
  });

  // The case the curated map exists for: generic title-casing would render "It".
  it('resolves the acronym member to its cased form', () => {
    expect(formatFormationOwnerTeam('it')).toBe('IT');
  });

  it('falls back to formatTag for off-enum upstream values', () => {
    expect(formatFormationOwnerTeam('PMO')).toBe('PMO');
    expect(formatFormationOwnerTeam('legal_review')).toBe('Legal Review');
  });

  // Object.hasOwn guard: a value colliding with an Object.prototype member must fall through to
  // formatTag, never resolve to a function off the prototype chain.
  it('treats a prototype-member name as an ordinary off-enum value', () => {
    expect(formatFormationOwnerTeam('constructor')).toBe('Constructor');
  });
});

describe('isFormationLifecycleLive (GH-2328)', () => {
  it('is true only for live', () => {
    expect(isFormationLifecycleLive('live')).toBe(true);
  });

  it('is false for both known terminal values', () => {
    expect(isFormationLifecycleLive('completed')).toBe(false);
    expect(isFormationLifecycleLive('frozen')).toBe(false);
  });

  // Mirrors normalizeFormationLifecycle's fail-closed contract: an unrecognized (null) lifecycle
  // must gate exactly like a known terminal one, not like live.
  it('is false for null (unrecognized upstream value)', () => {
    expect(isFormationLifecycleLive(null)).toBe(false);
  });
});

describe('getFormationQueueStageDisplay (GH-2366)', () => {
  it('renders the canonical label/severity for a mapped sub-stage', () => {
    expect(getFormationQueueStageDisplay('engaged', 'Formation - Engaged')).toEqual({ label: 'Formation · Engaged', severity: 'accent' });
  });

  it('renders the raw upstream value verbatim, muted, for an unmapped sub-stage', () => {
    expect(getFormationQueueStageDisplay(null, 'Active')).toEqual({ label: 'Active', severity: 'secondary' });
    expect(getFormationQueueStageDisplay(null, 'Formation - Disengaged')).toEqual({ label: 'Formation - Disengaged', severity: 'secondary' });
  });

  it('falls back to an em dash when the raw value itself is empty', () => {
    expect(getFormationQueueStageDisplay(null, '')).toEqual({ label: '—', severity: 'secondary' });
  });
});

describe('normalizeFormationActivityAction (GH-2372)', () => {
  it('recognizes every one of the 14 real upstream actions', () => {
    const actions = [
      'status_changed',
      'assignee_changed',
      'evidence_link_changed',
      'due_date_changed',
      'note_changed',
      'sub_items_changed',
      'skip_reason_changed',
      'item_updated',
      'item_accepted',
      'item_rejected',
      'item_reopened',
      'platform_check_resolved',
      'template_expanded',
      'template_upgraded',
    ] as const;

    for (const action of actions) {
      expect(normalizeFormationActivityAction(action)).toBe(action);
    }
  });

  it('never coerces an unrecognized action into a plausible neighbour', () => {
    expect(normalizeFormationActivityAction('item_teleported')).toBeNull();
  });

  it('guards Object.prototype key collisions via Object.hasOwn, not `in`', () => {
    expect(normalizeFormationActivityAction('__proto__')).toBeNull();
    expect(normalizeFormationActivityAction('toString')).toBeNull();
    expect(normalizeFormationActivityAction('constructor')).toBeNull();
  });

  it('returns null for null/undefined/empty', () => {
    expect(normalizeFormationActivityAction(null)).toBeNull();
    expect(normalizeFormationActivityAction(undefined)).toBeNull();
    expect(normalizeFormationActivityAction('')).toBeNull();
  });
});

describe('getFormationActivityDisplay (GH-2372)', () => {
  function entry(overrides: Partial<FormationActivity> = {}): FormationActivity {
    return {
      uid: 'activity-1',
      formation_item_uid: 'item-1',
      action: 'status_changed',
      action_raw: 'status_changed',
      set_by: 'user',
      actor: { username: 'sam.chen', name: 'sam.chen' },
      before: { status: 'not_started', assignee: null },
      after: { status: 'in_progress', assignee: null },
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('renders the mapped label as the summary for a recognized action', () => {
    expect(getFormationActivityDisplay(entry()).summary).toBe('changed the status');
  });

  it('renders action_raw verbatim as the summary for an unmapped action', () => {
    const result = getFormationActivityDisplay(entry({ action: null, action_raw: 'item_teleported' }));
    expect(result.summary).toBe('item_teleported');
    expect(result.detail).toBeNull();
  });

  it('builds a status detail line through FORMATION_ITEM_STATUS_LABELS for status-bearing actions', () => {
    expect(getFormationActivityDisplay(entry()).detail).toBe('Not started → In progress');
  });

  it('falls back to "No status" (not "Unassigned") for a null status, distinct from the assignee fallback', () => {
    const result = getFormationActivityDisplay(entry({ before: { status: null, assignee: null }, after: { status: 'in_progress', assignee: null } }));
    expect(result.detail).toBe('No status → In progress');
  });

  it('builds an assignee detail line, falling back to "Unassigned" for a null assignee', () => {
    const result = getFormationActivityDisplay(
      entry({
        action: 'assignee_changed',
        action_raw: 'assignee_changed',
        before: { status: null, assignee: null },
        after: { status: null, assignee: 'sam.chen' },
      })
    );
    expect(result.detail).toBe('Unassigned → sam.chen');
  });

  it('returns a null detail for actions whose changed value is not carried in the feed', () => {
    // due_date_changed / note_changed / evidence_link_changed / sub_items_changed / skip_reason_changed:
    // upstream's redacted before/after summary only carries {status, assignee}, so the actual new
    // value is genuinely unavailable — never fabricated.
    for (const action of ['due_date_changed', 'note_changed', 'evidence_link_changed', 'sub_items_changed', 'skip_reason_changed'] as const) {
      const result = getFormationActivityDisplay(
        entry({ action, action_raw: action, before: { status: 'in_progress', assignee: null }, after: { status: 'in_progress', assignee: null } })
      );
      expect(result.detail).toBeNull();
    }
  });

  it('returns a null detail for template-level actions', () => {
    expect(getFormationActivityDisplay(entry({ action: 'template_expanded', action_raw: 'template_expanded' })).detail).toBeNull();
    expect(getFormationActivityDisplay(entry({ action: 'template_upgraded', action_raw: 'template_upgraded' })).detail).toBeNull();
  });

  it('returns a null detail when before/after are absent', () => {
    expect(getFormationActivityDisplay(entry({ before: null, after: null })).detail).toBeNull();
  });
});

describe('buildFormationItemOwnerMailto', () => {
  it('returns null when there is no email (caller renders plain text)', () => {
    expect(buildFormationItemOwnerMailto({ email: '', itemTitle: 'Sign legal docs' })).toBeNull();
    expect(buildFormationItemOwnerMailto({ email: null })).toBeNull();
  });

  it('builds a mailto with a percent-encoded subject and body, address left bare', () => {
    const href = buildFormationItemOwnerMailto({
      email: 'ada@example.com',
      itemTitle: 'Sign & seal',
      projectName: 'Example Project',
      dueDate: '2026-10-01',
      detailUrl: 'https://lfx.dev/project/formation?project=example&item=1',
    });

    expect(href).toBe(
      'mailto:ada@example.com?subject=Sign%20%26%20seal%20%E2%80%94%20Example%20Project&body=Due%3A%202026-10-01%0Ahttps%3A%2F%2Flfx.dev%2Fproject%2Fformation%3Fproject%3Dexample%26item%3D1'
    );
  });

  it('joins title and project name with an em dash and omits empty parts', () => {
    expect(buildFormationItemOwnerMailto({ email: 'a@b.com', itemTitle: 'Only Title' })).toBe('mailto:a@b.com?subject=Only%20Title');
    expect(buildFormationItemOwnerMailto({ email: 'a@b.com' })).toBe('mailto:a@b.com');
  });

  it('degrades the body gracefully when dueDate or detailUrl is missing', () => {
    expect(buildFormationItemOwnerMailto({ email: 'a@b.com', detailUrl: 'https://x/1' })).toBe('mailto:a@b.com?body=https%3A%2F%2Fx%2F1');
    expect(buildFormationItemOwnerMailto({ email: 'a@b.com', dueDate: '2026-10-01' })).toBe('mailto:a@b.com?body=Due%3A%202026-10-01');
  });

  it('rejects addresses that could inject mailto headers', () => {
    expect(buildFormationItemOwnerMailto({ email: 'a?subject=evil@b.com', itemTitle: 'T' })).toBeNull();
    expect(buildFormationItemOwnerMailto({ email: 'a&cc=x@b.com' })).toBeNull();
    expect(buildFormationItemOwnerMailto({ email: 'has space@b.com' })).toBeNull();
    expect(buildFormationItemOwnerMailto({ email: 'no-at-sign' })).toBeNull();
    // Percent-encoded CRLF + Bcc header-injection attempt must not survive the allowlist.
    expect(buildFormationItemOwnerMailto({ email: 'victim@example.com%0D%0ABcc:attacker@example.com' })).toBeNull();
    expect(buildFormationItemOwnerMailto({ email: 'two@at@example.com' })).toBeNull();
  });
});

describe('buildFormationItemDeepLinkUrl', () => {
  it('builds the checklist deep-link URL with the project slug and item uid percent-encoded', () => {
    expect(buildFormationItemDeepLinkUrl('https://lfx.dev', 'example project', 'item uid/1')).toBe(
      'https://lfx.dev/project/formation?project=example%20project&item=item%20uid%2F1'
    );
  });
});
