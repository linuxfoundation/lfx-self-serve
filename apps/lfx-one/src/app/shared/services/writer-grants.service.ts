// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, DestroyRef, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WRITER_GRANTS_SESSION_CACHE_KEY } from '@lfx-one/shared/constants';
import { WriterSummary } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { ProjectService } from '@services/project.service';
import { map } from 'rxjs';

/** Fallback delay when `requestIdleCallback` isn't available (e.g. older Safari). */
const IDLE_SWEEP_FALLBACK_DELAY_MS = 2000;

/**
 * Whether the user holds a `writer` grant on a foundation-level and/or non-foundation project —
 * the same authorization `writerGuard` enforces. The only consumer is {@link LensService}, which
 * OR's these into its allowed-lens set (LFXV2-2754): a `writer` grant is authority over that
 * project, so the lens that reaches it must be available regardless of which persona was detected.
 *
 * Two-phase, both kicked off post-hydration in `afterNextRender` (LFXV2-2857):
 *  - **Fast path** — `ProjectService.getWriterSummary()` hits a `filter_grants=direct`-scoped
 *    endpoint (sub-second). Direct grants only, so it under-reports *inherited* access (e.g. a
 *    foundation-level writer's implicit access to a non-foundation child they hold no direct
 *    tuple on).
 *  - **Deferred sweep** — the existing unscoped `ProjectService.getProjects()` (the same call
 *    that used to run here directly and block bootstrap for 11-19s), rescheduled via
 *    `requestIdleCallback` so it starts well after first paint and doesn't count toward RUM's
 *    `@view.loading_time`. Resolves inherited access; only ever OR-merges into the two signals
 *    (widens, never narrows) and runs at most once per session (cached to `sessionStorage`).
 *
 * Both signals start `false` and only ever transition to `true` within a session — never back.
 */
@Injectable({
  providedIn: 'root',
})
export class WriterGrantsService {
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly hasWriterFoundationInternal: WritableSignal<boolean> = signal(false);
  private readonly hasWriterProjectInternal: WritableSignal<boolean> = signal(false);

  /** True once a writer-held project satisfying `computeIsFoundation` is known — fast path first, deferred sweep may widen later. */
  public readonly hasWriterFoundation: Signal<boolean> = this.hasWriterFoundationInternal.asReadonly();

  /** True once a writer-held non-foundation project is known — fast path first, deferred sweep may widen later. */
  public readonly hasWriterProject: Signal<boolean> = this.hasWriterProjectInternal.asReadonly();

  public constructor() {
    // Runs browser-only, once the first render is committed — see the class doc for why both
    // calls live here rather than at construction.
    afterNextRender(() => {
      // Apply any widening cached from an earlier bootstrap this session BEFORE either network
      // call fires, so a repeat page load never regresses below what was already established.
      const cached = this.readCache();
      if (cached) {
        this.widen(cached);
      }

      this.projectService
        .getWriterSummary()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((summary) => this.widen(summary));

      // Only run the slow sweep once per session — a cache hit means an earlier bootstrap this
      // session already ran it.
      if (!cached) {
        this.runWhenIdle(() => this.runDeferredSweep());
      }
    });
  }

  /** OR-merge — only ever widens, never narrows, so the fast path, deferred sweep, and cache can land in any order. */
  private widen(summary: WriterSummary): void {
    if (summary.hasWriterFoundation) this.hasWriterFoundationInternal.set(true);
    if (summary.hasWriterProject) this.hasWriterProjectInternal.set(true);
  }

  private runDeferredSweep(): void {
    this.projectService
      .getProjects()
      .pipe(
        map(
          (projects): WriterSummary => ({
            hasWriterFoundation: projects.some((project) => project.writer === true && computeIsFoundation(project)),
            hasWriterProject: projects.some((project) => project.writer === true && !computeIsFoundation(project)),
          })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((summary) => {
        this.widen(summary);
        this.writeCache({ hasWriterFoundation: this.hasWriterFoundationInternal(), hasWriterProject: this.hasWriterProjectInternal() });
      });
  }

  private runWhenIdle(cb: () => void): void {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(cb);
    } else {
      setTimeout(cb, IDLE_SWEEP_FALLBACK_DELAY_MS);
    }
  }

  private readCache(): WriterSummary | null {
    try {
      const raw = sessionStorage.getItem(WRITER_GRANTS_SESSION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.hasWriterFoundation === 'boolean' && typeof parsed?.hasWriterProject === 'boolean') {
        return parsed as WriterSummary;
      }
      return null;
    } catch {
      return null;
    }
  }

  private writeCache(summary: WriterSummary): void {
    try {
      sessionStorage.setItem(WRITER_GRANTS_SESSION_CACHE_KEY, JSON.stringify(summary));
    } catch {
      /* sessionStorage unavailable/full — non-fatal, the sweep just re-runs next session */
    }
  }
}
