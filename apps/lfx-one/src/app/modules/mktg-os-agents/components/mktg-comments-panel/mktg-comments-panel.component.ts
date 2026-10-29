// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal, signal } from '@angular/core';
import { _IdGenerator } from '@angular/cdk/a11y';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_DOCUMENT_COMMENT_LIMITS } from '@lfx-one/shared/constants';
import type { MktgDocumentCommentScope, MktgRedraftLanding, MktgRedraftProgress, MktgRunActivity } from '@lfx-one/shared/interfaces';
import { mktgDocumentCommentTab } from '@lfx-one/shared/utils';
import { MktgDocumentCommentsService } from '@services/mktg-document-comments.service';
import { MktgDocumentRedraftClientService } from '@services/mktg-document-redraft-client.service';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subscription, distinctUntilChanged, finalize } from 'rxjs';
import { MktgCommentThreadComponent } from '../mktg-comment-thread/mktg-comment-thread.component';

@Component({
  selector: 'lfx-mktg-comments-panel',
  imports: [ButtonComponent, MktgCommentThreadComponent, MktgRunActivityComponent],
  templateUrl: './mktg-comments-panel.component.html',
})
export class MktgCommentsPanelComponent {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly comments = inject(MktgDocumentCommentsService);
  private readonly redrafts = inject(MktgDocumentRedraftClientService);
  private readonly ids = inject(_IdGenerator);

  // Private lifecycle state, separate from reactive UI signals.
  private work?: Subscription;
  private storing = false;
  private landingTab?: string;

  public readonly scope = input.required<MktgDocumentCommentScope>();
  public readonly content = input<unknown>(null);
  public readonly priorVersion = input<number | null>(null);
  public readonly ready = output<MktgRedraftLanding>();
  protected readonly reasonId = this.ids.getId('mktg-comments-reason-');

  protected readonly expandedThreads = signal(new Set<string>());
  protected readonly accepted = signal(false);
  protected readonly runPending = signal(false);
  protected readonly retrySend = signal(false);
  protected readonly releaseAvailable = signal(false);
  protected readonly activity = signal<MktgRunActivity[]>([]);
  protected readonly startedAt = signal(0);
  protected readonly message = signal('');

  protected readonly openCount = computed(
    () => this.comments.threads().filter((row) => row.status === 'open' && row.revisionId === this.scope().revisionId).length
  );
  protected readonly showSend = computed(
    () => (this.comments.loaded() && !this.comments.loadError() && this.openCount() > 0) || this.retrySend() || this.runPending()
  );
  protected readonly sendLabel = this.initSendLabel();
  protected readonly disabledReason = this.initDisabledReason();
  protected readonly maySend = this.initMaySend();
  protected readonly labelContext = computed(() => ({ agentKey: this.scope().agentKey, content: this.content() }));

  public constructor() {
    toObservable(computed(() => ({ scope: this.scope(), content: this.content() })))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ scope, content }) => {
        this.comments.select(scope);
        this.comments.setLabelContent(content);
      });
    toObservable(this.comments.draftScopeKey)
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.expandedThreads.set(new Set());
        this.work?.unsubscribe();
        this.message.set('');
        this.activity.set([]);
        this.runPending.set(false);
        this.landingTab = undefined;
        this.syncRecovery();
        if (this.redrafts.hasAcceptedAttempt(this.scope())) this.observe(this.redrafts.resume(this.scope())); // Read-only: never auto-resubmit an unknown ACK.
      });
    this.destroyRef.onDestroy(() => {
      this.work?.unsubscribe();
      this.comments.select(null);
    });
  }
  protected setExpanded(id: string, expanded: boolean): void {
    this.expandedThreads.update((current) => {
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  protected refresh(): void {
    this.comments.refresh();
  }
  protected send(): void {
    if (!this.maySend()) return;
    if (!this.retrySend()) {
      const pinned = this.comments
        .threads()
        .filter((row) => row.status === 'open' && row.revisionId === this.scope().revisionId)
        .at(-1);
      this.landingTab = pinned ? mktgDocumentCommentTab(this.scope().agentKey, pinned.anchor.key) : undefined;
    }
    this.observe(this.redrafts.send(this.scope(), this.priorVersion() ?? 0));
  }
  protected release(): void {
    if (!this.releaseAvailable()) return;
    const owner = this.comments.draftScopeKey();
    this.work?.unsubscribe();
    this.runPending.set(true);
    this.work = this.redrafts
      .release(this.scope())
      .pipe(
        finalize(() => {
          if (owner === this.comments.draftScopeKey()) this.runPending.set(false);
        })
      )
      .subscribe({
        next: () => {
          if (owner === this.comments.draftScopeKey()) {
            this.retrySend.set(false);
            this.releaseAvailable.set(false);
            this.message.set('Send released. Choose Send explicitly when ready.');
          }
        },
        error: (error: unknown) => {
          if (owner === this.comments.draftScopeKey()) this.showError(error, true);
        },
      });
  }
  // Private initializers.
  private initSendLabel(): Signal<string> {
    return computed(() => {
      if (this.retrySend()) return 'Retry the same redraft';
      if (!this.comments.loaded() || this.comments.loading() || this.comments.loadError()) return 'Send comments to the agent';
      const count = this.openCount();
      return `Send ${count} open comment${count === 1 ? '' : 's'} to the agent`;
    });
  }
  private initDisabledReason(): Signal<string> {
    return computed(() => {
      if (this.comments.loadError()) return 'Retry comments before sending.';
      if (!this.comments.loaded() || this.comments.loading()) return 'Loading comments…';
      if (this.comments.saving()) return 'Saving your comment…';
      if (this.runPending()) return 'Waiting for this redraft…';
      if (this.retrySend()) return '';
      if (!Number.isSafeInteger(this.priorVersion()) || (this.priorVersion() ?? 0) < 1) return 'This revision has no stored source to redraft';
      if (!this.openCount()) return 'Add an open comment first';
      const limit = MKTG_DOCUMENT_COMMENT_LIMITS[this.scope().agentKey];
      if (this.openCount() > limit) return `This agent takes up to ${limit} comments per send — resolve or remove some`;
      return '';
    });
  }
  private initMaySend(): Signal<boolean> {
    return computed(() => !this.disabledReason());
  }

  // Other private helpers.
  private observe(stream: Observable<MktgRedraftProgress>): void {
    const owner = this.comments.draftScopeKey();
    this.work?.unsubscribe();
    this.runPending.set(true);
    this.accepted.set(this.redrafts.hasAcceptedAttempt(this.scope()));
    this.releaseAvailable.set(false);
    this.startedAt.set(Date.now());
    this.message.set('');
    this.storing = false;
    this.work = stream
      .pipe(
        finalize(() => {
          if (owner === this.comments.draftScopeKey()) this.runPending.set(false);
        })
      )
      .subscribe({
        next: (progress) => {
          if (owner !== this.comments.draftScopeKey()) return;
          if (progress.type === 'submitted') this.accepted.set(true);
          if (progress.type === 'activity') this.activity.set(progress.activity);
          if (progress.type === 'storing') {
            this.storing = true;
            this.message.set('Written. Saving the new Draft revision…');
          }
          if (progress.type === 'failed') {
            this.storing = false;
            this.message.set(progress.message);
          }
          if (progress.type === 'ready') {
            this.storing = false;
            this.ready.emit(this.landingTab ? { ...progress.location, tab: this.landingTab } : progress.location);
          }
        },
        error: (error: unknown) => {
          if (owner === this.comments.draftScopeKey()) this.showError(error);
        },
        complete: () => {
          if (owner !== this.comments.draftScopeKey()) return;
          this.syncRecovery();
          if (this.redrafts.hasAcceptedAttempt(this.scope())) this.message.set('The agent is still working on this redraft. Retry checks the same run.');
          else if (this.storing) this.message.set('The new revision could not be confirmed. Retry checks the same run.');
        },
      });
  }
  private showError(error: unknown, releasing = false): void {
    this.syncRecovery();
    const code = error instanceof HttpErrorResponse ? error.error?.code : '';
    if (this.redrafts.hasAcceptedAttempt(this.scope())) {
      this.message.set('The agent is still working on this redraft. Retry checks the same run.');
    } else if (releasing && code === 'MKTG_REDRAFT_COMMENTS_BUSY') {
      this.message.set('Still starting — retry shortly.');
    } else if (this.releaseAvailable()) {
      this.message.set('Try the same send again, or release it. Release may say still starting until the hold expires.');
    } else {
      this.message.set(
        this.retrySend()
          ? 'The redraft could not be confirmed. Try the same send again.'
          : 'The send was not accepted. Review the open comments and send again.'
      );
    }
  }
  private syncRecovery(): void {
    this.accepted.set(this.redrafts.hasAcceptedAttempt(this.scope()));
    this.retrySend.set(this.redrafts.hasIntent(this.scope()));
    this.releaseAvailable.set(this.redrafts.canRelease(this.scope()));
  }
}
