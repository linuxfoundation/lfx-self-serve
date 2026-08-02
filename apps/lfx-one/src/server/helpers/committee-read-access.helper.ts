// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { assertCommitteeAccess } from './committee-access.internal.helper';

/**
 * Read gate for committee-scoped analytics that bypass the FGA-enforced committee-service proxy
 * every other committee route relies on (this endpoint reads Snowflake directly). `:uid` is the
 * analytics filter, never the authorization — mirrors `assertOrgLensRead`'s rationale — so the
 * caller's grant is resolved independently before any Snowflake query runs.
 *
 * Checks `committee#auditor`, not `committee#viewer`: per the platform FGA model
 * (`charts/lfx-platform/files/model.fga` in `lfx-v2-helm`), `viewer` is defined as
 * `[user:*] or member or auditor` — the `[user:*]` wildcard makes it resolve `true` for *any*
 * authenticated caller on a committee marked public, which would leak per-member attendance counts
 * to callers with no relationship to the committee. `auditor` (`[user, team#member] or writer or
 * auditor from project or meeting_coordinator from project`, JTBD "View committee settings") has
 * no such wildcard.
 *
 * This also means a rank-and-file `member` (not also a `writer`/project-level `auditor`) cannot
 * read their own committee's engagement data — deliberate: per-member attendance rollups read as
 * leadership/oversight data, not general committee-member data, so this defaults to the narrower
 * grant rather than widening to `member` (or the model's `roster_viewer`) without an explicit
 * product decision to do so.
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` (not `checkSingleAccess`) because the latter
 * swallows upstream failures into `false`, making a transient access-check outage indistinguishable
 * from a genuine denial. Strict resolution distinguishes a *thrown* upstream failure (503) from a
 * resolved `false` (403) — both fail closed, the split is about signal accuracy, not safety. This
 * is incomplete, not absolute: `performCheck` itself resolves `false` (not a throw) when the
 * access-check response omits the requested tuple entirely — e.g. a truncated or malformed
 * `results` array — so that case still surfaces here as a confident-looking 403 rather than a 503,
 * same as it would through `checkSingleAccess`.
 *
 * A nonexistent `committeeUid` also resolves to no `auditor` tuple, i.e. 403, same as a real
 * committee the caller can't see — deliberate, avoids a separate existence check. This follows from
 * how OpenFGA's Check API works, not from an assumption about this endpoint: Check evaluates a
 * relationship graph and answers `false` when no path exists, it never requires the object to be
 * pre-registered, so an unknown object ID is not a distinct error case upstream — there is nothing
 * for `checkSingleAccessStrict` to throw on.
 *
 * Must run before any cache read or Snowflake query so an ungranted caller never reaches the data.
 * (Mechanics — forbidden/unavailable construction, checkSingleAccessStrict handling — live in the
 * shared `assertCommitteeAccess`; this function only owns the relation choice above.)
 */
export async function assertCommitteeRead(req: Request, committeeUid: string, operation: string): Promise<void> {
  return assertCommitteeAccess(req, committeeUid, operation, 'auditor', 'read');
}
