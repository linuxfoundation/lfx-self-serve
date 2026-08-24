// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Signal, WritableSignal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  PreferenceContext,
  UserPreferenceCommitArgs,
  UserPreferenceQueuedCommit,
  UserPreferenceState,
  UserPreferenceStoreConfig,
} from '@lfx-one/shared/interfaces';
import { EMPTY, Observable, Subject, catchError, concatMap, distinctUntilChanged, finalize, from, switchMap, takeUntil, tap } from 'rxjs';

/**
 * PCC `UserPreferenceStore` port (LFXV2-3002 Block 0): optimistic, queue-ordered, cancel-on-context-change
 * persistence against a name-keyed BFF transport, plus an SSR gate. Plain class — host feature services `new` it with a config.
 */
export class UserPreferenceStore<T> {
  private readonly stateSignal: WritableSignal<UserPreferenceState<T>>;
  public readonly state: Signal<UserPreferenceState<T>>;

  private readonly contextSignal = signal<PreferenceContext | null>(null);
  private readonly cancelPersist$ = new Subject<void>();
  private readonly commitTrigger$ = new Subject<UserPreferenceQueuedCommit<T>>();

  public constructor(private readonly config: UserPreferenceStoreConfig<T>) {
    this.stateSignal = signal<UserPreferenceState<T>>({
      data: config.initial(),
      loading: false,
      readOnly: false,
      error: null,
    });
    this.state = this.stateSignal.asReadonly();

    if (config.isBrowser) {
      this.initLoadPipeline();
      this.initCommitPipeline();
    }
  }

  public setContext(ctx: PreferenceContext | null): void {
    if (!this.config.isBrowser) return;
    // Same logical context: skip the cancel — distinctUntilChanged suppresses the reload, so an in-flight write would die silently.
    const current = this.contextSignal();
    if (current?.userId === ctx?.userId && current?.projectId === ctx?.projectId) return;
    // Publish the new context before cancelling: concatMap dequeues synchronously on cancel, so queued commits must already fail isSameContext.
    this.contextSignal.set(ctx);
    this.cancelPersist$.next();
  }

  public replace(data: T): void {
    this.stateSignal.update((s) => ({ ...s, data }));
  }

  public commit(args: UserPreferenceCommitArgs<T>): void {
    if (!this.config.isBrowser) return;
    // Never round-trip data the parser flagged read-only (e.g. unknown schema version) — a commit would overwrite it.
    if (this.stateSignal().readOnly) return;

    const ctx = this.contextSignal();
    if (!ctx) return;

    const optimistic = args.optimistic !== false;
    const previous = this.stateSignal().data;
    if (optimistic) {
      this.stateSignal.update((s) => ({ ...s, data: args.next }));
    }

    const expectedSerialized = this.config.serialize(args.next);
    this.commitTrigger$.next({
      ctx,
      next: args.next,
      rebase: args.rebase,
      optimistic,
      rollback:
        args.rollback ??
        (() => {
          if (this.config.serialize(this.stateSignal().data) !== expectedSerialized) return;
          this.replace(previous);
        }),
      onSuccess: args.onSuccess,
      onError: args.onError,
    });
  }

  private initLoadPipeline(): void {
    toObservable(this.contextSignal, { injector: this.config.injector })
      .pipe(
        distinctUntilChanged((a, b) => a?.userId === b?.userId && a?.projectId === b?.projectId),
        switchMap((ctx) => {
          this.stateSignal.set({ data: this.config.initial(), loading: !!ctx, readOnly: false, error: null });
          this.config.onContextChange?.(ctx);
          return ctx ? this.fetchPreference$(ctx) : EMPTY;
        }),
        takeUntilDestroyed(this.config.destroyRef)
      )
      .subscribe();
  }

  private fetchPreference$(ctx: PreferenceContext): Observable<unknown> {
    return from(this.config.transport.get(this.config.preferenceName(ctx.projectId))).pipe(
      tap((value) => {
        if (value === null) {
          this.stateSignal.update((s) => ({ ...s, data: this.config.initial(), readOnly: false, error: null }));
          this.config.onLoaded?.(null);
          return;
        }
        const result = this.config.parse(value);
        this.stateSignal.update((s) => ({ ...s, data: result.data, readOnly: !!result.readOnly, error: null }));
        this.config.onLoaded?.(result);
      }),
      catchError((err) => {
        this.stateSignal.update((s) => ({ ...s, data: this.config.initial(), readOnly: false, error: err }));
        this.config.onLoadError?.(err);
        return EMPTY;
      }),
      finalize(() => this.stateSignal.update((s) => ({ ...s, loading: false })))
    );
  }

  private initCommitPipeline(): void {
    this.commitTrigger$
      .pipe(
        concatMap((q) => this.processCommit$(q)),
        takeUntilDestroyed(this.config.destroyRef)
      )
      .subscribe();
  }

  private processCommit$(q: UserPreferenceQueuedCommit<T>): Observable<unknown> {
    const isSameContext = (): boolean => {
      const cur = this.contextSignal();
      return !!cur && cur.userId === q.ctx.userId && cur.projectId === q.ctx.projectId;
    };

    if (!isSameContext()) return EMPTY;

    // Rebase against post-rollback state so a queued write never resurrects a mutation whose commit failed.
    const next = q.rebase ? q.rebase(this.stateSignal().data) : q.next;

    const onSuccess = (): void => {
      if (!isSameContext()) return;
      if (!q.optimistic) {
        this.replace(next);
      }
      q.onSuccess?.();
    };

    const onError = (): void => {
      if (!isSameContext()) return;
      q.rollback();
      q.onError?.();
    };

    const name = this.config.preferenceName(q.ctx.projectId);
    const serialized = this.config.serialize(next);

    if (this.config.shouldDeleteOnEmpty?.(next)) {
      return from(this.config.transport.delete(name)).pipe(
        takeUntil(this.cancelPersist$),
        tap(() => onSuccess()),
        catchError(() => this.reconcileDelete$(name, onSuccess, onError))
      );
    }

    return this.persistWrite$(name, serialized, onSuccess, onError);
  }

  private persistWrite$(name: string, serialized: string, onSuccess: () => void, onError: () => void): Observable<unknown> {
    return from(this.config.transport.put(name, serialized)).pipe(
      takeUntil(this.cancelPersist$),
      tap(() => onSuccess()),
      catchError(() => this.reconcileWrite$(name, serialized, onSuccess, onError))
    );
  }

  // Same landed-but-timed-out hazard as reconcileWrite$: re-GET, treat an absent value as a
  // successful delete, otherwise retry the delete once and roll back only after that fails.
  private reconcileDelete$(name: string, onSuccess: () => void, onError: () => void): Observable<unknown> {
    return from(this.config.transport.get(name)).pipe(
      takeUntil(this.cancelPersist$),
      switchMap((stored) => {
        if (stored === null) {
          onSuccess();
          return EMPTY;
        }
        return from(this.config.transport.delete(name)).pipe(
          takeUntil(this.cancelPersist$),
          tap(() => onSuccess()),
          catchError(() => {
            onError();
            return EMPTY;
          })
        );
      }),
      catchError(() => {
        onError();
        return EMPTY;
      })
    );
  }

  // A failed write may still have landed (e.g. timeout after the upstream commit — PCC's row-ID
  // reconciliation, adapted to name-keying). Re-GET: a matching stored value means success; otherwise retry once.
  private reconcileWrite$(name: string, serialized: string, onSuccess: () => void, onError: () => void): Observable<unknown> {
    return from(this.config.transport.get(name)).pipe(
      takeUntil(this.cancelPersist$),
      switchMap((stored) => {
        if (stored === serialized) {
          onSuccess();
          return EMPTY;
        }
        return from(this.config.transport.put(name, serialized)).pipe(
          takeUntil(this.cancelPersist$),
          tap(() => onSuccess()),
          catchError(() => {
            onError();
            return EMPTY;
          })
        );
      }),
      catchError(() => {
        onError();
        return EMPTY;
      })
    );
  }
}
