// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { WeeklyBriefSourceChip, WeeklyBriefSourceChipAction, WeeklyBriefSourceRef } from '../interfaces';

/**
 * Font Awesome icon per `WeeklyBriefSourceRef.kind`. `kind` is an open string (not a literal
 * union — see the interface's doc comment), so this is a lookup table with a `??` fallback
 * rather than an exhaustive switch, mirroring `COMMITTEE_DOCUMENT_TYPE_ICONS`'s pattern in
 * `committee-documents.constants.ts`. Covers every kind `lfx-v2-committee-service`'s
 * `group_weekly_brief_generator.go` actually emits (`meeting`, `mailing-list`, `vote`,
 * `members`) plus `doc` — documented on `WeeklyBriefSourceRef` but not currently emitted;
 * kept mapped in case upstream starts sending it, same as any other future kind would fall
 * to the fallback below instead of breaking.
 */
const SOURCE_REF_ICONS: Record<string, string> = {
  meeting: 'fa-light fa-clock-rotate-left',
  doc: 'fa-light fa-file-lines',
  'mailing-list': 'fa-light fa-envelope',
  vote: 'fa-light fa-check-to-slot',
  members: 'fa-light fa-users',
};
const SOURCE_REF_FALLBACK_ICON = 'fa-light fa-circle-question';

/** Chip label when `WeeklyBriefSourceRef.title` is absent or empty. */
const SOURCE_REF_DEFAULT_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  doc: 'Document',
  'mailing-list': 'Mailing List',
  vote: 'Vote',
  members: 'Members',
};

/**
 * Resolves a source ref to its click-through action. `mailing-list` has no archive URL anywhere
 * in this contract (`GroupsIOMailingList`/`MailingList` carry none) — omitting its link is the
 * documented v1 behavior, not a gap. Any other unrecognized `kind` falls back the same way, so a
 * future upstream kind this mapping doesn't know about renders unlinked instead of breaking.
 */
function resolveSourceRefAction(ref: WeeklyBriefSourceRef): WeeklyBriefSourceChipAction | null {
  switch (ref.kind) {
    case 'meeting':
      return { kind: 'past-meeting', meetingId: ref.id, password: null };
    case 'doc':
      return { kind: 'tab', tab: 'documents' };
    case 'vote':
      // The drawer, not the generic Votes tab: ref.id carries the vote's own uid, and
      // committee-overview.component.ts already owns vote-drawer lookup/fetch/toast handling.
      //
      // Deliberately NOT gated on committee.enable_voting the way the activity feed's
      // mapActivityEventsToFeedItems filters out vote events for a voting-disabled committee
      // — that gate hides a *live* feature area the committee currently doesn't have turned
      // on. A brief's source_refs describe a specific past window that can predate voting
      // being disabled, and the drawer here is read-only (allowCastFromDrawer=false in
      // committee-overview.component.html), so surfacing a historical vote a brief already
      // referenced isn't the same class of exposure as offering to cast a new one.
      return { kind: 'vote-drawer', voteUid: ref.id };
    case 'members':
      return { kind: 'tab', tab: 'members' };
    default:
      return null;
  }
}

/** One ref mapped to its chip shape, before dedup grouping. */
function buildChip(ref: WeeklyBriefSourceRef): WeeklyBriefSourceChip {
  return {
    id: ref.id,
    kind: ref.kind,
    // `||`, not `??`: an empty-string title should also fall through to the default label —
    // an untitled "doc" chip shouldn't render blank.
    label: ref.title || SOURCE_REF_DEFAULT_LABELS[ref.kind] || ref.kind,
    icon: SOURCE_REF_ICONS[ref.kind] ?? SOURCE_REF_FALLBACK_ICON,
    action: resolveSourceRefAction(ref),
  };
}

// A separator for groupChips's grouping key that can't appear in a kind or a title.
const GROUP_KEY_SEPARATOR = String.fromCharCode(0);

/**
 * Collapses chips sharing the same `(kind, title)` into a single count-badged chip — e.g. 12
 * instances of a recurring meeting all titled "AAIF Technical Committee Meeting" become one
 * chip with `group.count === 12` instead of 12 identical-looking chips (LFXV2-3335). Keyed on
 * the raw `ref.title`, not the resolved `chip.label`: an absent/empty title falls back to a
 * kind-generic default label in `buildChip` (e.g. "Meeting"), and grouping on that would wrongly
 * collapse unrelated untitled refs of the same kind into one group — an untitled ref is keyed by
 * its own `id` instead, making it always its own group of one. `WeeklyBriefSourceRef` has no
 * date/timestamp field to distinguish same-title instances by, so each collapsed instance is
 * ordinal-labeled (" #1", " #2", ...) in `source_refs` order rather than a date range.
 *
 * A group of size 1 is returned unchanged (no `group` field), and `Map` insertion order already
 * matches first-occurrence order in `refs`, so no separate order-tracking is needed.
 */
function groupChips(refs: WeeklyBriefSourceRef[]): WeeklyBriefSourceChip[] {
  const groups = new Map<string, WeeklyBriefSourceChip[]>();
  for (const ref of refs) {
    // Separator-joined, not plain concatenation: a titled key can't collide with an untitled
    // one (untitled keys start with the separator; kind is always non-empty), and a titled
    // key's kind/title halves can't collide with each other regardless of what characters a
    // title contains (e.g. a colon in "Q1: Budget Review").
    const key = ref.title ? `${ref.kind}${GROUP_KEY_SEPARATOR}${ref.title}` : `${GROUP_KEY_SEPARATOR}${ref.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(buildChip(ref));
    } else {
      groups.set(key, [buildChip(ref)]);
    }
  }

  return Array.from(groups.values(), (members) => {
    if (members.length === 1) {
      return members[0];
    }
    const [first] = members;
    return {
      id: first.id,
      kind: first.kind,
      label: first.label,
      icon: first.icon,
      action: null,
      group: {
        count: members.length,
        // Precomputed, not built in the template (frontend-checklist §4) — the group chip's tag
        // renders this directly.
        badgeLabel: `${first.label} (${members.length})`,
        instances: members.map((member, index) => ({ ...member, label: `${member.label} #${index + 1}` })),
      },
    };
  });
}

/**
 * Maps a `WeeklyBrief.source_refs[]` to the "Sources" chip row's view-model — precomputed here,
 * not resolved per-chip in the template (repo rule: `docs/reviews/frontend-checklist.md` §4).
 * Deduped/grouped via `groupChips` (LFXV2-3335); overall chip order follows first-occurrence
 * order of each `(kind, title)` group in `source_refs`.
 */
export function mapWeeklyBriefSourceRefsToChips(sourceRefs: WeeklyBriefSourceRef[]): WeeklyBriefSourceChip[] {
  return groupChips(sourceRefs);
}
