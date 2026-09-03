// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  RECONCILIATION_MAX_ATTENDEES_PER_AI_CALL,
  RECONCILIATION_MAX_CANDIDATES_PER_AI_CALL,
  RECONCILIATION_MAX_CONCURRENT_AI_CALLS,
  RECONCILIATION_MAX_PRIOR_OCCURRENCES,
} from '@lfx-one/shared/constants';
import {
  AttendanceReconciliationCandidate,
  AttendanceReconciliationResult,
  ITXUpdatePastMeetingParticipantRequest,
  PastMeeting,
  PastMeetingParticipant,
  ReconcilePastMeetingParticipantsResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { AiService } from './ai.service';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { MeetingService } from './meeting.service';

/**
 * Attendance reconciliation for past-meeting participants (GH-1672 / PCC-1452 port).
 *
 * Kept out of MeetingService — this is matching/orchestration logic layered on top of
 * MeetingService's existing participant CRUD (item 3), not a new CRUD surface of its own.
 *
 * `MeetingService.getPastMeetingParticipants` now dedupes by pairwise identity match (see that
 * method's doc comment) rather than a single derived key, so the `unverified`/`invitees` lists
 * this service builds on are already correctly merged before `isSamePersonForReconciliation`
 * below ever runs on the wider candidate pool.
 */
export class AttendanceReconciliationService {
  private meetingService: MeetingService;
  private committeeService: CommitteeService;
  private aiService: AiService;

  public constructor() {
    this.meetingService = new MeetingService();
    this.committeeService = new CommitteeService();
    this.aiService = new AiService();
  }

  /**
   * Runs reconciliation for every unverified participant of one past-meeting occurrence:
   * builds a candidate pool (occurrence invitees + committee members + previously-verified
   * attendees of prior occurrences), matches deterministically first, falls back to the AI
   * service for the ambiguous remainder, and auto-applies only `confidence: 'high'` matches —
   * and only when the candidate pool itself is complete. A degraded pool (a committee-member or
   * prior-occurrence fetch failed and was silently dropped) disables auto-apply for the whole
   * call: a missing source could hide the real match for a candidate that would otherwise
   * auto-apply against the wrong identity, so every result is queued for review instead.
   * `confidence: 'none'` is NEVER auto-applied — it is always returned for admin review, per
   * the fix for PCC-1452's silent "auto-tagged unknown" bug.
   */
  public async reconcilePastMeetingParticipants(
    req: Request,
    pastMeetingUid: string,
    pastMeeting: PastMeeting
  ): Promise<ReconcilePastMeetingParticipantsResponse> {
    logger.debug(req, 'reconcile_attendance_pool', 'Starting attendance reconciliation', { past_meeting_id: pastMeetingUid });

    const participants = await this.meetingService.getPastMeetingParticipants(req, pastMeetingUid);
    const unverified = participants.filter((p) => p.is_attended && !p.is_verified);

    if (unverified.length === 0) {
      return { results: [], candidate_pool_size: 0, auto_applied_count: 0, needs_review_count: 0, pool_degraded: false };
    }

    const { candidates, degraded } = await this.buildCandidatePool(req, pastMeetingUid, pastMeeting, participants);

    const { deterministic, remainder } = this.matchDeterministically(unverified, candidates);

    const aiMatched = remainder.length > 0 ? await this.matchWithAi(req, remainder, candidates) : [];

    const combined = [...deterministic, ...aiMatched];

    const results = await Promise.all(
      combined.map(async (result) => {
        // Only a deterministic exact-identity match may auto-apply. An AI-derived match is
        // never auto-applied regardless of its stated confidence — the model's input includes
        // attendee-controlled Zoom display names, so a 'high' confidence from the AI path
        // cannot be trusted as a basis for an unattended write. AI matches always queue for
        // admin review.
        if (result.method !== 'deterministic' || result.confidence !== 'high' || !result.matched_candidate || degraded) {
          return result;
        }

        const applied = await this.applyMatch(req, pastMeetingUid, result.attendee_id, result.matched_candidate);
        return { ...result, auto_applied: applied };
      })
    );

    const autoAppliedCount = results.filter((r) => r.auto_applied).length;
    const needsReviewCount = results.filter((r) => !r.auto_applied).length;

    logger.info(req, 'reconcile_attendance_pool', 'Attendance reconciliation completed', {
      unverified_count: unverified.length,
      candidate_pool_size: candidates.length,
      auto_applied_count: autoAppliedCount,
      needs_review_count: needsReviewCount,
      pool_degraded: degraded,
    });

    return {
      results,
      candidate_pool_size: candidates.length,
      auto_applied_count: autoAppliedCount,
      needs_review_count: needsReviewCount,
      pool_degraded: degraded,
    };
  }

  /**
   * Union of three candidate sources, deduped via `isSamePersonForReconciliation` — a single-
   * source pool (just that occurrence's invitees) was PCC's PCC-1452 root cause.
   */
  private async buildCandidatePool(
    req: Request,
    pastMeetingUid: string,
    pastMeeting: PastMeeting,
    occurrenceParticipants: PastMeetingParticipant[]
  ): Promise<{ candidates: AttendanceReconciliationCandidate[]; degraded: boolean }> {
    const invitees = occurrenceParticipants.filter((p) => p.is_invited);

    let committeeSourceDegraded = false;
    const committeeMembers = (
      await Promise.all(
        (pastMeeting.committees || []).map((committee) =>
          this.committeeService.getCommitteeMembers(req, committee.uid).catch((error) => {
            logger.warning(req, 'reconcile_attendance_pool', 'Failed to fetch committee members, continuing without them', {
              committee_uid: committee.uid,
              err: error,
            });
            committeeSourceDegraded = true;
            return [];
          })
        )
      )
    ).flat();

    const { attendees: priorAttendees, degraded: priorSourceDegraded } = await this.getPriorVerifiedAttendees(req, pastMeeting.meeting_id, pastMeetingUid);

    const pool: AttendanceReconciliationCandidate[] = [];
    let nextId = 0;

    const pushIfNew = (candidate: Omit<AttendanceReconciliationCandidate, 'candidate_id'>): void => {
      if (!candidate.email && !candidate.username && !candidate.lf_user_id && !(candidate.first_name && candidate.last_name)) {
        return;
      }
      const existingIndex = pool.findIndex((c) => this.isSamePersonForReconciliation(c, candidate));
      if (existingIndex === -1) {
        pool.push({ ...candidate, candidate_id: `c${nextId++}` });
        return;
      }
      const existing = pool[existingIndex];
      pool[existingIndex] = {
        ...existing,
        email: existing.email || candidate.email,
        username: existing.username || candidate.username,
        lf_user_id: existing.lf_user_id || candidate.lf_user_id,
        first_name: existing.first_name || candidate.first_name,
        last_name: existing.last_name || candidate.last_name,
        org_name: existing.org_name || candidate.org_name,
      };
    };

    invitees.forEach((p) =>
      pushIfNew({
        source: 'invitee',
        email: p.email,
        username: p.username,
        first_name: p.first_name,
        last_name: p.last_name,
        org_name: p.org_name,
      })
    );

    committeeMembers.forEach((m) =>
      pushIfNew({
        source: 'committee_member',
        email: m.email,
        username: m.username,
        first_name: m.first_name,
        last_name: m.last_name,
        org_name: m.organization?.name,
      })
    );

    priorAttendees.forEach((p) =>
      pushIfNew({
        source: 'prior_attendee',
        email: p.email,
        username: p.username,
        first_name: p.first_name,
        last_name: p.last_name,
        org_name: p.org_name,
      })
    );

    return { candidates: pool, degraded: committeeSourceDegraded || priorSourceDegraded };
  }

  /**
   * Scans up to RECONCILIATION_MAX_PRIOR_OCCURRENCES most-recent prior occurrences of the same
   * series for participants already marked `is_verified` — Stephan's "we should even store it"
   * carry-forward signal, and the direct answer to PCC-1451 for this port's candidate pool.
   */
  private async getPriorVerifiedAttendees(
    req: Request,
    meetingUid: string,
    currentOccurrenceId: string
  ): Promise<{ attendees: PastMeetingParticipant[]; degraded: boolean }> {
    let degraded = false;
    const occurrences = await this.meetingService.getPastOccurrencesForMeeting(req, meetingUid, { throwOnFailure: true }).catch((error) => {
      logger.warning(req, 'reconcile_attendance_pool', 'Failed to fetch prior occurrences, continuing without them', {
        meeting_id: meetingUid,
        err: error,
      });
      degraded = true;
      return [];
    });
    const priorOccurrences = occurrences.filter((o) => o.meeting_and_occurrence_id !== currentOccurrenceId).slice(-RECONCILIATION_MAX_PRIOR_OCCURRENCES);

    const perOccurrence = await Promise.all(
      priorOccurrences.map((o) =>
        this.meetingService.getPastMeetingParticipants(req, o.meeting_and_occurrence_id).catch((error) => {
          logger.warning(req, 'reconcile_attendance_pool', 'Failed to fetch prior occurrence participants, continuing without them', {
            past_meeting_id: o.meeting_and_occurrence_id,
            err: error,
          });
          degraded = true;
          return [];
        })
      )
    );

    return { attendees: perOccurrence.flat().filter((p) => p.is_verified), degraded };
  }

  /**
   * Identity comparator for candidate-pool dedup. Local to this service — does not depend on
   * PR #2060's `isSamePerson` (unmerged, non-stacked branch). Mirrors that comparator's branch
   * order: prefer overlapping email, then username (this repo's LFID-equivalent), then
   * normalized name — an email match takes priority over username asymmetry, so two records
   * sharing an email still merge even if only one carries a username.
   */
  private isSamePersonForReconciliation(
    a: { email?: string; username?: string; first_name?: string; last_name?: string },
    b: { email?: string; username?: string; first_name?: string; last_name?: string }
  ): boolean {
    const emailA = a.email?.trim().toLowerCase();
    const emailB = b.email?.trim().toLowerCase();
    if (emailA && emailB) {
      return emailA === emailB;
    }

    const usernameA = a.username?.trim().toLowerCase();
    const usernameB = b.username?.trim().toLowerCase();
    if (usernameA && usernameB) {
      return usernameA === usernameB;
    }

    const nameA = this.normalizeName(a.first_name, a.last_name);
    const nameB = this.normalizeName(b.first_name, b.last_name);
    return !!nameA && !!nameB && nameA === nameB;
  }

  private normalizeName(firstName?: string, lastName?: string): string | undefined {
    if (!firstName || !lastName) {
      return undefined;
    }
    return `${firstName.trim().toLowerCase()} ${lastName.trim().toLowerCase()}`;
  }

  /**
   * A raw, not-yet-identified Zoom attendee (the exact population this feature targets) has no
   * reason to carry a populated `first_name`/`last_name` — those are enrichment fields set once a
   * match is found. `zoom_user_name` is the only display name guaranteed to exist for such an
   * attendee, so it must be preferred over reconstructing from first/last name, which is empty for
   * the very attendees this service is trying to match.
   */
  private getDisplayName(attendee: PastMeetingParticipant): string {
    if (attendee.zoom_user_name) {
      return attendee.zoom_user_name;
    }
    return [attendee.first_name, attendee.last_name].filter(Boolean).join(' ').trim();
  }

  /**
   * Cheap deterministic pass: exact email match, then username match. No LLM call — only the
   * genuinely ambiguous remainder is handed to `matchWithAi`.
   */
  private matchDeterministically(
    unverified: PastMeetingParticipant[],
    candidates: AttendanceReconciliationCandidate[]
  ): {
    deterministic: AttendanceReconciliationResult[];
    remainder: PastMeetingParticipant[];
  } {
    const deterministic: AttendanceReconciliationResult[] = [];
    const remainder: PastMeetingParticipant[] = [];

    for (const attendee of unverified) {
      const email = attendee.email?.trim().toLowerCase();
      const username = attendee.username?.trim().toLowerCase();

      const match =
        (email && candidates.find((c) => c.email?.trim().toLowerCase() === email)) ||
        (username && candidates.find((c) => c.username?.trim().toLowerCase() === username));

      if (match) {
        deterministic.push({
          attendee_id: attendee.uid,
          zoom_user_name: this.getDisplayName(attendee),
          confidence: 'high',
          method: 'deterministic',
          matched_candidate: match,
          auto_applied: false,
        });
      } else {
        remainder.push(attendee);
      }
    }

    return { deterministic, remainder };
  }

  /**
   * Sends the ambiguous remainder to AiService.reconcileAttendees, chunked at
   * RECONCILIATION_MAX_ATTENDEES_PER_AI_CALL so a large occurrence doesn't produce one
   * unbounded prompt. Any attendee_id the model omits is treated as confidence 'none' rather
   * than lost. Skips the call entirely (all 'none') when the AI service isn't configured —
   * matching queues are still safe without it.
   */
  private async matchWithAi(
    req: Request,
    remainder: PastMeetingParticipant[],
    candidates: AttendanceReconciliationCandidate[]
  ): Promise<AttendanceReconciliationResult[]> {
    if (!this.aiService.isAiConfigured()) {
      return remainder.map((attendee) => ({
        attendee_id: attendee.uid,
        zoom_user_name: this.getDisplayName(attendee),
        confidence: 'none',
        method: 'ai',
        auto_applied: false,
      }));
    }

    const chunks: PastMeetingParticipant[][] = [];
    for (let i = 0; i < remainder.length; i += RECONCILIATION_MAX_ATTENDEES_PER_AI_CALL) {
      chunks.push(remainder.slice(i, i + RECONCILIATION_MAX_ATTENDEES_PER_AI_CALL));
    }

    const chunkResults: AttendanceReconciliationResult[][] = new Array(chunks.length);
    let nextChunkIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextChunkIndex < chunks.length) {
        const chunkIndex = nextChunkIndex++;
        const chunk = chunks[chunkIndex];
        chunkResults[chunkIndex] = await this.matchChunkWithAi(req, chunk, candidates);
      }
    };

    await Promise.all(Array.from({ length: Math.min(RECONCILIATION_MAX_CONCURRENT_AI_CALLS, chunks.length) }, () => worker()));

    return chunkResults.flat();
  }

  /**
   * Ranks the full candidate pool for one chunk's attendees and truncates to
   * RECONCILIATION_MAX_CANDIDATES_PER_AI_CALL — a large pool otherwise scales prompt size with
   * pool size on top of attendee count. Ranked by normalized-name token overlap against the
   * chunk's attendees so the candidates most plausibly relevant to this specific chunk survive
   * truncation, rather than an arbitrary prefix of the pool.
   */
  private rankCandidatesForChunk(chunk: PastMeetingParticipant[], candidates: AttendanceReconciliationCandidate[]): AttendanceReconciliationCandidate[] {
    if (candidates.length <= RECONCILIATION_MAX_CANDIDATES_PER_AI_CALL) {
      return candidates;
    }

    const attendeeTokens = new Set(chunk.flatMap((attendee) => this.getDisplayName(attendee).toLowerCase().split(/\s+/).filter(Boolean)));

    const score = (candidate: AttendanceReconciliationCandidate): number => {
      const candidateTokens = [candidate.first_name, candidate.last_name, candidate.username]
        .filter(Boolean)
        .flatMap((value) => value!.toLowerCase().split(/\s+/));
      return candidateTokens.filter((token) => attendeeTokens.has(token)).length;
    };

    return [...candidates].sort((a, b) => score(b) - score(a)).slice(0, RECONCILIATION_MAX_CANDIDATES_PER_AI_CALL);
  }

  private async matchChunkWithAi(
    req: Request,
    chunk: PastMeetingParticipant[],
    candidates: AttendanceReconciliationCandidate[]
  ): Promise<AttendanceReconciliationResult[]> {
    try {
      const rankedCandidates = this.rankCandidatesForChunk(chunk, candidates);
      const response = await this.aiService.reconcileAttendees(req, {
        attendees: chunk.map((a) => ({ attendee_id: a.uid, zoom_user_name: this.getDisplayName(a) })),
        candidates: rankedCandidates,
      });

      const byId = new Map(response.matches.map((m) => [m.attendee_id, m]));

      return chunk.map((attendee) => {
        const match = byId.get(attendee.uid);
        const matchedCandidate = match?.matched_candidate_id ? rankedCandidates.find((c) => c.candidate_id === match.matched_candidate_id) : undefined;

        // Only trust the model's stated confidence when its candidate_id actually resolved.
        // A resolved-confidence + no-candidate combination (omitted attendee, hallucinated
        // candidate_id, or a spec-violating null-candidate-but-non-none-confidence response)
        // always degrades to 'none' rather than surfacing a misleading confidence with nothing
        // attached to it.
        const confidence = match && matchedCandidate ? match.confidence : ('none' as const);

        return {
          attendee_id: attendee.uid,
          zoom_user_name: this.getDisplayName(attendee),
          confidence,
          method: 'ai' as const,
          matched_candidate: matchedCandidate,
          auto_applied: false,
        };
      });
    } catch (error) {
      // A transient AI failure on one chunk must not sink the whole reconciliation call —
      // the deterministic matches already computed for other attendees would otherwise be
      // lost along with it. Degrade this chunk to 'none' so it queues for review instead.
      logger.warning(req, 'reconcile_attendance_pool', 'AI reconciliation chunk failed, queuing attendees for review', {
        attendee_count: chunk.length,
        err: error,
      });
      return chunk.map((attendee) => ({
        attendee_id: attendee.uid,
        zoom_user_name: this.getDisplayName(attendee),
        confidence: 'none' as const,
        method: 'ai' as const,
        auto_applied: false,
      }));
    }
  }

  /**
   * Writes a high-confidence deterministic match back onto the attendee's participant record —
   * only called for `method === 'deterministic'` results (see the auto-apply gate in
   * `reconcilePastMeetingParticipants`), so `is_ai_reconciled` is always `false` here; an
   * AI-derived match is never auto-applied and therefore never reaches this method. Sets
   * `is_attended: true` explicitly — the upstream ITX handler no-ops an attendee update when
   * `is_attended` is omitted, so leaving it out would silently fail to persist while this
   * service still reported `auto_applied: true`. Identity fields (`first_name`/`last_name`/
   * `org_name`) are intentionally left off this write — those are invitee-record fields, not
   * appropriate to overwrite on an attendee's own record from a matched candidate.
   */
  private async applyMatch(req: Request, pastMeetingUid: string, attendeeId: string, candidate: AttendanceReconciliationCandidate): Promise<boolean> {
    const update: ITXUpdatePastMeetingParticipantRequest = {
      is_verified: true,
      is_attended: true,
      is_ai_reconciled: false,
      is_auto_matched: true,
      ...(candidate.email && { email: candidate.email }),
      ...(candidate.username && { username: candidate.username }),
      ...(candidate.lf_user_id && { lf_user_id: candidate.lf_user_id }),
    };

    try {
      await this.meetingService.updatePastMeetingParticipant(req, pastMeetingUid, attendeeId, update);
      return true;
    } catch (error) {
      logger.warning(req, 'reconcile_attendance_pool', 'Failed to auto-apply high-confidence match, leaving for review', {
        past_meeting_id: pastMeetingUid,
        attendee_id: attendeeId,
        err: error,
      });
      return false;
    }
  }
}
