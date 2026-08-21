// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MKTG_ANSWER_MEMORY_KEY_PREFIX, MKTG_ANSWER_MEMORY_MAX_VALUE_CHARS, MKTG_ANSWER_MEMORY_TTL_MS } from '@lfx-one/shared/constants';
import { MktgAnswerMemory, MktgRememberedAnswer } from '@lfx-one/shared/interfaces';

import { UserService } from './user.service';

/**
 * Per-(user, project) memory of the intake answers a user has already given to
 * Marketing OS agents, keyed by intake FIELD KEY (`github_url`,
 * `project_name`, …) — shared vocabulary across agents, which is what makes an
 * answer given to one agent reusable by the next.
 *
 * It exists because "we already asked you this" is the worst thing a
 * marketplace of agents can do: LFX prefill only covers what LFX itself
 * stores, and a project with no `repository_url` on record left the Message
 * Foundation form asking for a repo URL the user had typed into the Brand Kit
 * minutes earlier.
 *
 * Precedence is deliberate and unchanged by this store: LFX project data wins,
 * a prior answer fills only what LFX left empty, and neither ever overwrites
 * something the user has already typed. Provenance is preserved with the value
 * (`agentId`) so the form can say WHERE a reused answer came from instead of
 * mislabelling it "From LFX".
 *
 * Storage mirrors the stored-run precedents: browser-only, scoped to the
 * EFFECTIVE user's sub (impersonation swaps `user()` in place), TTL-pruned on
 * read, and best-effort on write — losing this memory costs a re-typed answer,
 * never correctness.
 */
@Injectable({ providedIn: 'root' })
export class MktgAnswerMemoryService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);

  /**
   * Remembered answers for a project, pruned of expired entries. Empty on the
   * server, when signed out, or when nothing has been submitted yet.
   */
  public load(projectUid: string): MktgAnswerMemory {
    const key = this.storageKey(projectUid);
    if (!key) {
      return {};
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as MktgAnswerMemory;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const fresh = Object.fromEntries(Object.entries(parsed).filter(([, entry]) => this.isUsable(entry)));
      // Rewrite only when the prune actually dropped something, so a read
      // never costs a write on the common path.
      if (Object.keys(fresh).length !== Object.keys(parsed).length) {
        this.write(key, fresh);
      }
      return fresh;
    } catch {
      return {};
    }
  }

  /**
   * Records the answers a run was submitted with, so a later agent's intake
   * can offer them back. Only the caller's own intake answers belong here —
   * never auto-attached dependency documents, which are document-sized and
   * already resolved from their own source.
   */
  public remember(projectUid: string, agentId: string, answers: Record<string, string>): void {
    const key = this.storageKey(projectUid);
    if (!key) {
      return;
    }
    const savedAt = new Date().toISOString();
    const next: MktgAnswerMemory = { ...this.load(projectUid) };
    let changed = false;
    for (const [fieldKey, value] of Object.entries(answers)) {
      const trimmed = (value ?? '').trim();
      if (!trimmed || trimmed.length > MKTG_ANSWER_MEMORY_MAX_VALUE_CHARS) {
        continue;
      }
      next[fieldKey] = { value: trimmed, agentId, savedAt };
      changed = true;
    }
    if (changed) {
      this.write(key, next);
    }
  }

  /** A remembered answer is usable while it has a value and its TTL has not elapsed. */
  private isUsable(entry: MktgRememberedAnswer): boolean {
    if (!entry || typeof entry.value !== 'string' || !entry.value.trim() || typeof entry.agentId !== 'string') {
      return false;
    }
    const savedAtMs = Date.parse(entry.savedAt ?? '');
    return !Number.isNaN(savedAtMs) && Date.now() - savedAtMs <= MKTG_ANSWER_MEMORY_TTL_MS;
  }

  /** Best-effort persist — a quota or disabled-storage failure only costs a re-typed answer. */
  private write(key: string, memory: MktgAnswerMemory): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(memory));
    } catch {
      // Ignore — the memory is a convenience, never a correctness dependency.
    }
  }

  /**
   * Storage key scoped to the EFFECTIVE user's sub and the project. Null on
   * the server, without a project, or when signed out: remembered answers are
   * one user's input on one project and must never surface under another's.
   */
  private storageKey(projectUid: string): string | null {
    if (!isPlatformBrowser(this.platformId) || !projectUid) {
      return null;
    }
    const userSub = this.userService.user()?.sub;
    if (!userSub) {
      return null;
    }
    return `${MKTG_ANSWER_MEMORY_KEY_PREFIX}:${userSub}:${projectUid}`;
  }
}
