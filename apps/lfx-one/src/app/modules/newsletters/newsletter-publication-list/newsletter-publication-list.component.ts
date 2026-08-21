// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, signal, Signal, computed } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, switchMap, EMPTY } from 'rxjs';

@Component({
  selector: 'lfx-newsletter-publication-list',
  standalone: true,
  imports: [CardComponent, EmptyStateComponent, TagComponent, SkeletonModule],
  templateUrl: './newsletter-publication-list.component.html',
  styleUrl: './newsletter-publication-list.component.scss',
})
export class NewsletterPublicationListComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  // === Writable Signals ===
  protected readonly publications = signal<NewsletterPublication[]>([]);
  // Start true: the context signal drives the first load on the next microtask,
  // so initialising to false would flash the empty state for one tick before
  // the skeletons appear.
  protected readonly loading = signal<boolean>(true);

  // === Reactive context ===
  public readonly projectUid: Signal<string> = this.projectContextService.activeContextUid;
  protected readonly hasPublications: Signal<boolean> = computed(() => this.publications().length > 0);

  public constructor() {
    this.initLoadOnContext();
  }

  protected goToPublicationEditions(publication: NewsletterPublication): void {
    this.router.navigate([publication.id], { relativeTo: this.route });
  }

  private initLoadOnContext(): void {
    toObservable(this.projectUid)
      .pipe(
        switchMap((uid) => {
          // Clear the previous context's rows before (re)loading, so a failed or
          // empty load never leaves the prior project's publications on screen.
          this.publications.set([]);
          if (!uid) {
            this.loading.set(false);
            return EMPTY;
          }
          this.loading.set(true);
          return this.newsletterService.listPublications(uid).pipe(
            catchError((err: HttpErrorResponse) => {
              this.loading.set(false);
              this.showLoadError(err);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        this.loading.set(false);
        this.publications.set(result.publications);
      });
  }

  private showLoadError(err: HttpErrorResponse, summary = 'Could not load publications'): void {
    this.messageService.add({
      severity: 'error',
      summary,
      detail: err?.error?.message || err?.message || 'Please try again later.',
    });
  }
}
