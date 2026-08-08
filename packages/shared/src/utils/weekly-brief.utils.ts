// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { WeeklyBriefSourceChip, WeeklyBriefSourceChipAction, WeeklyBriefSourceRef } from '../interfaces';

/**
 * Font Awesome icon per `WeeklyBriefSourceRef.kind`. `kind` is an open string (not a literal
 * union — see the interface's doc comment), so this is a lookup table with a `??` fallback
 * rather than an exhaustive switch, mirroring `COMMITTEE_DOCUMENT_TYPE_ICONS`'s pattern in
 * `committee-documents.constants.ts`.
 */
const SOURCE_REF_ICONS: Record<string, string> = {
  meeting: 'fa-light fa-clock-rotate-left',
  doc: 'fa-light fa-file-lines',
  'mailing-list': 'fa-light fa-envelope',
  members: 'fa-light fa-users',
};
const SOURCE_REF_FALLBACK_ICON = 'fa-light fa-circle-question';

/** Chip label when `WeeklyBriefSourceRef.title` is absent or empty. */
const SOURCE_REF_DEFAULT_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  doc: 'Document',
  'mailing-list': 'Mailing List',
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
    case 'members':
      return { kind: 'tab', tab: 'members' };
    default:
      return null;
  }
}

/**
 * Maps a `WeeklyBrief.source_refs[]` to the "Sources" chip row's view-model — precomputed here,
 * not resolved per-chip in the template (repo rule: `docs/reviews/frontend-checklist.md` §4).
 */
export function mapWeeklyBriefSourceRefsToChips(sourceRefs: WeeklyBriefSourceRef[]): WeeklyBriefSourceChip[] {
  return sourceRefs.map((ref) => ({
    id: ref.id,
    // `||`, not `??`: an empty-string title should also fall through to the default label —
    // an untitled "doc" chip shouldn't render blank.
    label: ref.title || SOURCE_REF_DEFAULT_LABELS[ref.kind] || ref.kind,
    icon: SOURCE_REF_ICONS[ref.kind] ?? SOURCE_REF_FALLBACK_ICON,
    action: resolveSourceRefAction(ref),
  }));
}
