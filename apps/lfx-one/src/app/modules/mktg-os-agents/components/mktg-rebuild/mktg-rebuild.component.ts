// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_AGENT_INTAKES, MKTG_LIVING_DOCUMENT_ID, MKTG_REBUILD_STEP_LABELS } from '@lfx-one/shared/constants';
import { MktgRebuildResponse, MktgRebuildStepView, MktgRevisionRef, MktgRunAnswer } from '@lfx-one/shared/interfaces';
import { buildMktgDocumentProjectPrefix, parseMktgRevisionKey } from '@lfx-one/shared/utils';
import { MktgRebuildService } from '@services/mktg-rebuild.service';
import { UserService } from '@services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { distinctUntilChanged, Observable, Subscription } from 'rxjs';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';
import { MktgRunQuestionsComponent } from '../../mktg-run-questions/mktg-run-questions.component';

@Component({
  selector: 'lfx-mktg-rebuild',
  imports: [ButtonComponent, MktgRunActivityComponent, MktgRunQuestionsComponent],
  templateUrl: './mktg-rebuild.component.html',
})
export class MktgRebuildComponent {
  private readonly api = inject(MktgRebuildService);
  private readonly user = inject(UserService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  public readonly project = input.required<string>();
  public readonly projectSlug = input<string | null>(null);
  public readonly projectName = input.required<string>();
  public readonly framework = input<MktgRevisionRef | null>(null);
  /** A successful writer-entitled documents listing is the Family page's grant evidence. */
  public readonly writer = input(false);
  public readonly autoStartRevisionId = input('');
  public readonly changed = output<void>();
  public readonly started = output<void>();
  public readonly chain = signal<MktgRebuildResponse | null>(null);
  public readonly error = signal('');
  public readonly sending = signal(false);
  protected readonly startedAt = signal(0);
  protected readonly livingId = MKTG_LIVING_DOCUMENT_ID;
  protected readonly moduleRoute = this.route.parent;
  private subscription?: Subscription;
  private usedAutoStart = '';
  public readonly active = computed(() => this.sending() || this.chain()?.status === 'running' || this.chain()?.status === 'questions');
  public readonly canStart = computed(
    () =>
      isPlatformBrowser(this.platform) &&
      this.writer() &&
      !this.user.impersonating() &&
      !!this.user.user()?.sub &&
      !!this.project() &&
      !!this.framework() &&
      !this.active()
  );
  protected readonly rows = this.initRows();

  public constructor() {
    toObservable(computed(() => JSON.stringify([this.project(), this.user.user()?.sub, this.user.impersonating()])))
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => {
        this.subscription?.unsubscribe();
        this.chain.set(null);
        this.error.set('');
        this.sending.set(false);
        this.usedAutoStart = '';
      });
    toObservable(
      computed(() => ({ auto: this.autoStartRevisionId(), allowed: this.canStart(), framework: this.framework()?.revisionId, project: this.project() }))
    )
      .pipe(takeUntilDestroyed())
      .subscribe(({ auto, allowed, framework, project }) => {
        if (auto && allowed && auto === framework && this.usedAutoStart !== `${project}:${auto}`) {
          this.usedAutoStart = `${project}:${auto}`;
          this.start();
        }
      });
    this.destroy.onDestroy(() => this.subscription?.unsubscribe());
  }

  public start(): void {
    const framework = this.framework();
    if (!this.canStart() || !framework) return;
    this.chain.set(null);
    this.error.set('');
    this.sending.set(true);
    this.startedAt.set(Date.now());
    this.started.emit();
    this.subscribe(this.api.run({ project: this.project(), frameworkRevisionId: framework.revisionId }));
  }

  protected answer(index: number, answers: MktgRunAnswer[]): void {
    const chain = this.chain();
    if (!chain || this.sending() || !this.writer() || this.user.impersonating()) return;
    this.error.set('');
    this.sending.set(true);
    this.startedAt.set(Date.now());
    this.subscribe(this.api.answer(chain, index, answers));
  }

  protected openDraft(row: MktgRebuildStepView): void {
    if (!row.revisionId || !this.projectSlug() || !isPlatformBrowser(this.platform)) return;
    const url = this.router.createUrlTree(['documents', row.agentKey, this.livingId], {
      relativeTo: this.moduleRoute,
      queryParams: { project: this.projectSlug(), revision: row.revisionId },
    });
    if (this.active()) window.open(this.router.serializeUrl(url), '_blank', 'noopener,noreferrer');
    else void this.router.navigateByUrl(url);
  }

  private initRows() {
    return computed<MktgRebuildStepView[]>(() =>
      (this.chain()?.steps ?? []).map((step, index) => {
        const receipt = step.persistence?.s3_key;
        const parsed = receipt && this.project() ? parseMktgRevisionKey(receipt, buildMktgDocumentProjectPrefix(this.project())) : null;
        return {
          ...step,
          index,
          label: MKTG_AGENT_INTAKES[step.agentId]?.documentName ?? 'Asset',
          statusLabel: MKTG_REBUILD_STEP_LABELS[step.status],
          revisionId: parsed?.agentKey === step.agentKey && parsed.documentId === MKTG_LIVING_DOCUMENT_ID ? parsed.id : null,
        };
      })
    );
  }

  private subscribe(stream: Observable<MktgRebuildResponse>): void {
    this.subscription?.unsubscribe();
    this.subscription = stream.subscribe({
      next: (chain) => {
        const runningIndex = chain.steps.findIndex((step) => step.status === 'running');
        if (runningIndex >= 0 && this.chain()?.steps[runningIndex]?.status !== 'running') this.startedAt.set(Date.now());
        this.chain.set(chain);
        this.sending.set(false);
        if (chain.status === 'complete' || chain.status === 'failed') this.changed.emit();
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.error.set(extractErrorMessage(error, 'Rebuild progress could not be loaded. Earlier Drafts are saved; reload the family before trying again.'));
        this.changed.emit();
      },
    });
  }
}
