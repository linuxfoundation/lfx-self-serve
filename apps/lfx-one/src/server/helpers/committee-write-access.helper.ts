// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { assertCommitteeAccess } from './committee-access.internal.helper';

/**
 * Write gate for committee-scoped mutations that proxy straight through to committee-service
 * with no authorization of their own (e.g. the WG Weekly Brief generate/save endpoints) —
 * `:committeeUid` is the mutation target, never the authorization, so the caller's grant is
 * resolved independently before any upstream write call runs.
 *
 * Checks `committee#writer`, not `committee#auditor`: the client-side equivalent of "can this
 * user mutate this committee" is `!!committee.writer` (see `committee-view.component.ts`'s
 * `canEdit`). Per the platform FGA model (`charts/lfx-platform/files/model.fga` in
 * `lfx-v2-helm`), `writer` (`[user] or writer from project`) is the relation explicitly tagged
 * `@fgadoc:jtbd Generate & edit the committee weekly brief` — this is its documented purpose.
 * `auditor` (see the sibling `assertCommitteeRead` in `committee-read-access.helper.ts`) is a
 * broader read/oversight relation (`[user, team#member] or writer or auditor from project or
 * meeting_coordinator from project`) — gating a write on it would let a read-only auditor
 * perform an action the UI never exposes to them.
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` (not `checkSingleAccess`) for the same
 * reason `assertCommitteeRead` does: distinguishes a resolved `false` (403) from a thrown
 * upstream failure (503) instead of collapsing both into "no access". A nonexistent
 * `committeeUid` also resolves to no `writer` tuple, i.e. 403, same as a real committee the
 * caller can't write to — deliberate, avoids a separate existence check.
 *
 * Must run before any proxy call so an ungranted caller's request never reaches upstream.
 * (Mechanics — forbidden/unavailable construction, checkSingleAccessStrict handling — live in the
 * shared `assertCommitteeAccess`; this function only owns the relation choice above.)
 */
export async function assertCommitteeWrite(req: Request, committeeUid: string, operation: string): Promise<void> {
  return assertCommitteeAccess(req, committeeUid, operation, 'writer', 'write');
}
