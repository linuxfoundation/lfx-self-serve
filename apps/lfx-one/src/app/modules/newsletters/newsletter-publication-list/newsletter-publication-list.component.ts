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
    // projectUid travels in the URL alongside the publication id, and
    // 'editions' disambiguates the route from the shareable reader permalink —
    // see newsletters.routes.ts.
    this.router.navigate([this.projectUid(), publication.id, 'editions'], { relativeTo: this.route });
  }

  // No dedicated publication-create UI exists yet (the publication create/manage
  // flow is the LFXV2-2582 follow-up — see newsletter.service.ts). Route the
  // empty-state CTA to the existing edition composer instead of a dead end;
  // the edition lands unfiled, which is a valid resting state.
  protected goToCreate(): void {
    this.router.navigate(['create'], { relativeTo: this.route });
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
          // The upstream list is paginated, and this page has no paging
          // controls, so follow the page tokens and show the whole set.
          return this.newsletterService.listAllPublications(uid).pipe(
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
