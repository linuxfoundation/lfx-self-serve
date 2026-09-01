// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEMPLATE_VERSION } from '@lfx-one/shared/constants';
import { FormationState } from '@lfx-one/shared/enums';
import type { Formation, FormationIntake } from '@lfx-one/shared/interfaces';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';

/**
 * Fixture-backed formation records (GH-1962/#1965 Epic 1). `lfx-v2-formation-service` (#1957)
 * isn't built yet, so this is the ENTIRE data layer for a formation until it lands — not a
 * degraded mode. The fixture convention (defined here, since neither sibling ticket #1958/#1959
 * had landed one at the time of writing — both worktrees were still at the same commit as
 * `main`):
 *
 * - No `NatsService` involvement at all. The read-only mock/live dual-branch pattern used by
 *   `committee-engagement.service.ts` (an `ENGAGEMENT_BACKEND` env toggle between a deterministic
 *   generator and a real Snowflake read) doesn't apply here — that pattern exists because a REAL
 *   backend exists somewhere to cut over to; there's no live formation-service subject to gate to
 *   yet, so a toggle would be dead code. Add one only once #1957 ships a real subject.
 * - This endpoint is create-then-read (submit, redirect, the confirmation page re-fetches the
 *   same formation by uid), so — unlike the stateless deterministic generators above — this
 *   holds a small module-level in-memory `Map<uid, Formation>` as its store. The store is
 *   per-POD, not just per-restart: `charts/lfx-self-serve/values.yaml` runs multiple replicas, so
 *   a GET can land on a pod that never saw the matching POST, not only after a restart. That's
 *   why `ProposeComponent` passes the just-created `Formation` to the confirmation route via
 *   router state instead of relying on this store for the primary redirect — the GET/this store
 *   is a best-effort fallback for a direct or refreshed confirmation link only, and a known
 *   fixture limitation there (not a bug), flagged in the PR description.
 * - Entries older than `FORMATION_STORE_TTL_MS` are swept (see `pruneExpired`) on every create
 *   AND every read, so a long-lived pod doesn't retain submitted contact PII (legal contact,
 *   additional contacts) past that window as long as it keeps receiving formation traffic. A pod
 *   that stops receiving ANY `/api/formations*` request after storing an entry has nothing left
 *   to trigger the sweep, so that entry lives until the pod restarts — accepted for a fixture
 *   with an already-documented per-pod lifetime, rather than adding a background timer.
 * - The store is also capped at `FORMATION_STORE_MAX_ENTRIES`, evicting oldest-first: unlike the
 *   other fixture Maps in this codebase (`credly.service.ts`, `github-readme.service.ts`, etc,
 *   which cache over a bounded, server-derived key space), this one is keyed by a fresh
 *   `randomUUID()` per authenticated POST — an unbounded key space driven entirely by client
 *   traffic. The TTL alone bounds age, not size, within that hour; the cap bounds worst-case
 *   memory regardless of request volume. Per-field length caps in `formation-validation.helper.ts`
 *   bound the size of each individual entry.
 * - Every response carries `data_source: 'mock'` (the same in-band provenance convention as
 *   `CommitteeEngagementResponse.data_source`) so a client can always tell fabricated data from
 *   real data once #1957 lands and this class grows a live branch.
 */
const FORMATION_STORE_TTL_MS = 60 * 60 * 1000;
const FORMATION_STORE_MAX_ENTRIES = 1000;

export class FormationService {
  private static readonly store = new Map<string, Formation>();

  /**
   * Creates a formation in `proposed` state with no linked project record
   * (`project_uid: null` — the "Record not yet created" fallback state). Per #1957's own Epic
   * 1/Epic 2 split, the real formation service writes the proposer's `participant` tuple itself
   * (no invite-service involved) — this fixture can't perform that FGA write (there's no real
   * `formation` resource yet to write against), so `participant_granted: true` on the response
   * reflects what the real service will have done, letting the client render the real Epic-1 UX
   * ahead of #1957 landing. Invite-service calls (Epic 2, #1992) and formation@/parent-writers
   * email notifications (no email-service integration in this repo) are TODO-logged, not sent.
   */
  public async createFormation(req: Request, intake: FormationIntake): Promise<Formation> {
    FormationService.pruneExpired();
    FormationService.evictOldestIfFull();

    const uid = randomUUID();
    const submittedBy = getEffectiveUsername(req) ?? 'unknown';

    logger.debug(req, 'create_formation', 'Creating fixture-backed formation record', { uid, project_name: intake.project_name });

    const formation: Formation = {
      uid,
      state: FormationState.PROPOSED,
      parent_project_uid: intake.parent_project_uid,
      project_uid: null,
      template_version: FORMATION_TEMPLATE_VERSION,
      submitted_by: submittedBy,
      submitted_at: new Date().toISOString(),
      intake,
      participant_granted: true,
      data_source: 'mock',
    };

    FormationService.store.set(uid, formation);

    // One INFO line with genuine production value (fixture provenance); the rest are static
    // build-time TODO markers that carry no per-request information and would otherwise print
    // identically on every submission — DEBUG per logging-patterns.md, not INFO.
    logger.info(req, 'create_formation', 'formation-service is not built yet (#1957) — returning a fabricated fixture record, not a real formation', {
      uid,
    });
    logger.debug(req, 'create_formation', 'TODO(#1957): proposer participant grant is simulated — the real formation service writes this tuple on submit', {
      uid,
    });
    logger.debug(req, 'create_formation', 'TODO(#1992): invite-service calls for the legal contact and any additional named contacts are Epic 2 — not sent', {
      uid,
      contact_count: intake.additional_contacts.length + 1,
    });
    logger.debug(
      req,
      'create_formation',
      'TODO: formation@ and the parent project writers notification email is not sent — no email-service integration in this repo',
      { uid }
    );

    return formation;
  }

  /**
   * Reads a fixture formation by uid. Returns null when unknown — including for a different pod
   * or after a server restart (see this class's doc comment) — or when the caller isn't the
   * proposer, so an unauthorized read looks identical to an unknown uid rather than confirming
   * the formation exists (no staff/`formation_admin` allowance yet — this repo has no such check
   * to reuse; add one when #1955/#1958 lands it).
   */
  public async getFormationByUid(req: Request, uid: string): Promise<Formation | null> {
    FormationService.pruneExpired();

    logger.debug(req, 'get_formation_by_uid', 'Reading fixture-backed formation record', { uid });
    const formation = FormationService.store.get(uid);
    if (!formation) {
      return null;
    }
    if (formation.submitted_by !== getEffectiveUsername(req)) {
      logger.warning(req, 'get_formation_by_uid', 'Formation exists but the caller is not the proposer; returning not-found', { uid });
      return null;
    }
    return formation;
  }

  /** Sweeps entries older than {@link FORMATION_STORE_TTL_MS} — an hour is far more than the
   *  submit→confirm round trip needs, bounding the fixture store's PII retention and growth. */
  private static pruneExpired(): void {
    const cutoff = Date.now() - FORMATION_STORE_TTL_MS;
    for (const [uid, formation] of FormationService.store) {
      if (new Date(formation.submitted_at).getTime() < cutoff) {
        FormationService.store.delete(uid);
      }
    }
  }

  /** Bounds worst-case memory regardless of request volume — see {@link FORMATION_STORE_MAX_ENTRIES}'s
   *  doc comment. `Map` preserves insertion order, so the first key is always the oldest entry. */
  private static evictOldestIfFull(): void {
    if (FormationService.store.size < FORMATION_STORE_MAX_ENTRIES) {
      return;
    }
    const oldestUid = FormationService.store.keys().next().value;
    if (oldestUid !== undefined) {
      FormationService.store.delete(oldestUid);
    }
  }
}
