// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { FilterPillOption, MyNewsletterListItem, Newsletter } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, of } from 'rxjs';

import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';

/**
 * Recipient-facing newsletter archive.
 * Lists sent newsletters for committees the user belongs to.
 * Filterable by foundation; click to view full newsletter in drawer.
 */
@Component({
  selector: 'lfx-my-newsletters-list',
  imports: [DatePipe, ButtonComponent, CardComponent, EmptyStateComponent, FilterPillsComponent, SkeletonModule, NewsletterPreviewDrawerComponent],
  templateUrl: './my-newsletters-list.component.html',
  styleUrl: './my-newsletters-list.component.scss',
})
export class MyNewslettersListComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly destroyRef = inject(DestroyRef);

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly loadingMore = signal<boolean>(false);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly previewVisible = signal<boolean>(false);
  protected readonly previewLoading = signal<boolean>(false);
  protected readonly previewNewsletter = signal<Newsletter | null>(null);
  protected readonly previewSubject = signal<string>('');
  protected readonly previewBodyHtml = signal<string>('');
  protected readonly previewDisplayName = signal<string>('');
  protected readonly selectedFoundation = signal<string>('');

  private readonly allNewsletters = signal<MyNewsletterListItem[]>([]);
  private loadGeneration = 0;

  // === Computed Signals ===
  protected readonly foundationOptions: Signal<FilterPillOption[]> = computed(() => {
    const foundations = new Set<string>();
    this.allNewsletters().forEach((nl) => {
      if (nl.foundation_slug) {
        foundations.add(nl.foundation_slug);
      }
    });
    return Array.from(foundations)
      .sort()
      .map((slug) => {
        const nl = this.allNewsletters().find((n) => n.foundation_slug === slug);
        return {
          id: slug,
          label: nl?.foundation_name || slug,
        };
      });
  });

  protected readonly filteredNewsletters: Signal<MyNewsletterListItem[]> = computed(() => {
    const selectedFoundation = this.selectedFoundation();
    const all = this.allNewsletters();

    if (!selectedFoundation) {
      return all;
    }

    return all.filter((nl) => nl.foundation_slug === selectedFoundation);
  });

  protected readonly canLoadMore: Signal<boolean> = computed(() => !!this.nextPageToken() && !this.loading() && !this.loadingMore());

  protected readonly isEmpty: Signal<boolean> = computed(() => this.allNewsletters().length === 0 && !this.loading());

  public constructor() {
    this.loadArchive();
  }

  protected onFoundationChange(foundationId: string): void {
    // Toggle: if already selected, deselect (show all); otherwise select this foundation
    const current = this.selectedFoundation();
    this.selectedFoundation.set(current === foundationId ? '' : foundationId);
  }

  protected loadMore(): void {
    const token = this.nextPageToken();

    if (!token || this.loading() || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    const currentGeneration = ++this.loadGeneration;

    this.newsletterService
      .listMyNewsletters(token)
      .pipe(
        catchError(() => of({ newsletters: [], next_page_token: undefined as string | undefined })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        // Discard stale responses from previous generations (project change/context shift)
        if (currentGeneration !== this.loadGeneration) {
          this.loadingMore.set(false);
          return;
        }

        const current = this.allNewsletters();
        this.allNewsletters.set([...current, ...response.newsletters]);
        this.nextPageToken.set(response.next_page_token);
        this.loadingMore.set(false);
      });
  }

  protected openPreview(item: MyNewsletterListItem, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }

    this.previewLoading.set(true);

    this.newsletterService
      .getMyNewsletterDetail(item.id)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((newsletter) => {
        if (newsletter) {
          this.previewNewsletter.set(newsletter);
          this.previewSubject.set(newsletter.subject);
          this.previewBodyHtml.set(newsletter.body_html);
          // Use created_by as the display name (creator email/identifier)
          this.previewDisplayName.set(newsletter.created_by);
          this.previewVisible.set(true);
        }
        this.previewLoading.set(false);
      });
  }

  private loadArchive(): void {
    this.allNewsletters.set([]);
    this.nextPageToken.set(undefined);
    this.selectedFoundation.set('');
    this.loading.set(true);
    this.loadGeneration++;
    const currentGeneration = this.loadGeneration;

    this.newsletterService
      .listMyNewsletters()
      .pipe(
        catchError(() => of({ newsletters: [], next_page_token: undefined as string | undefined })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        // Discard stale responses
        if (currentGeneration !== this.loadGeneration) {
          return;
        }

        this.allNewsletters.set(response.newsletters);
        this.nextPageToken.set(response.next_page_token);
        this.loading.set(false);
      });
  }
}
