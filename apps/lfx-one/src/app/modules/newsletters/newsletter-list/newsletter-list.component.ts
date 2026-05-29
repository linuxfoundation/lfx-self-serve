// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FilterPillOption, NewsletterListItem, NewsletterRow, NewsletterStatus, NewsletterStatusTabId, ProjectContext } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, distinctUntilChanged, finalize, take } from 'rxjs';

import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';

@Component({
  selector: 'lfx-newsletter-list',
  imports: [
    DatePipe,
    ButtonComponent,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    TableComponent,
    TagComponent,
    ConfirmDialogModule,
    TooltipModule,
    NewsletterPreviewDrawerComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './newsletter-list.component.html',
  styleUrl: './newsletter-list.component.scss',
})
export class NewsletterListComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly newsletterService = inject(NewsletterService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  // === Tab options ===
  protected readonly statusTabOptions: FilterPillOption[] = [
    { id: 'draft', label: 'Drafts' },
    { id: 'sent', label: 'Sent' },
  ];

  // === Writable Signals ===
  protected readonly statusTab = signal<NewsletterStatusTabId>('draft');
  protected readonly newsletters = signal<NewsletterListItem[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadingMore = signal<boolean>(false);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly previewVisible = signal<boolean>(false);
  protected readonly selectedNewsletter = signal<NewsletterListItem | null>(null);

  // === Reactive context ===
  // Newsletters are project-only — the foundation lens hides this feature.
  // We still expose isFoundationContext so the template can show a
  // "switch to a project to view newsletters" empty state.
  public readonly activeContext: Signal<ProjectContext | null> = this.projectContextService.activeContext;
  public readonly isFoundationContext: Signal<boolean> = this.projectContextService.isFoundationContext;
  public readonly projectUid: Signal<string> = this.projectContextService.activeContextUid;
  public readonly hasContext: Signal<boolean> = computed(() => this.projectUid().length > 0 && !this.isFoundationContext());
  protected readonly canLoadMore: Signal<boolean> = computed(() => !!this.nextPageToken() && !this.loading() && !this.loadingMore());
  protected readonly hasNewsletters: Signal<boolean> = computed(() => this.newsletters().length > 0);

  // Pre-compute per-row labels so the template doesn't call functions-with-args.
  protected readonly rows: Signal<NewsletterRow[]> = computed(() =>
    this.newsletters().map((n) => {
      const total = n.total_recipients ?? 0;
      const opens = n.unique_opens ?? 0;
      const groupCount = n.committee_uids?.length ?? 0;
      const openRateLabel = n.open_rate === undefined || n.open_rate === null ? '—' : `${Math.round(n.open_rate * 100)}%`;
      return {
        ...n,
        openRateLabel,
        openRateTooltip: `${opens} of ${total} recipients opened`,
        recipientsLabel: n.total_recipients !== undefined && n.total_recipients !== null ? String(n.total_recipients) : '—',
        groupsLabel: `${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`,
      };
    })
  );

  public constructor() {
    const tabFromQuery = this.route.snapshot.queryParamMap.get('tab');
    if (tabFromQuery === 'sent' || tabFromQuery === 'draft') {
      this.statusTab.set(tabFromQuery);
    }
    this.initLoadOnContextOrTab();
  }

  protected onStatusTabChange(tab: string): void {
    if (tab === 'draft' || tab === 'sent') {
      this.statusTab.set(tab);
    }
  }

  protected goToCreate(): void {
    this.router.navigate(['..', 'create'], { relativeTo: this.route });
  }

  protected goToRow(item: NewsletterListItem): void {
    const target = this.statusTab() === 'sent' ? 'analytics' : 'edit';
    this.router.navigate(['..', item.id, target], { relativeTo: this.route });
  }

  protected openPreview(item: NewsletterListItem, event: Event): void {
    event.stopPropagation();
    this.selectedNewsletter.set(item);
    this.previewVisible.set(true);
  }

  protected loadMore(): void {
    const token = this.nextPageToken();
    if (!token || this.loadingMore() || !this.hasContext()) return;
    this.loadingMore.set(true);
    this.newsletterService
      .listNewsletters(this.projectUid(), {
        status: this.statusTab() as NewsletterStatus,
        page_token: token,
      })
      .pipe(
        take(1),
        finalize(() => this.loadingMore.set(false))
      )
      .subscribe({
        next: (response) => {
          this.newsletters.update((current) => [...current, ...response.newsletters]);
          this.nextPageToken.set(response.next_page_token);
        },
        error: (err: HttpErrorResponse) => this.showLoadError(err),
      });
  }

  protected onDeleteDraft(item: NewsletterListItem, event: Event): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      header: 'Delete draft?',
      message: `Are you sure you want to delete "${item.subject || 'Untitled draft'}"? This action cannot be undone.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.runDelete(item.id),
    });
  }

  private runDelete(id: string): void {
    if (!this.hasContext()) return;
    this.deletingId.set(id);
    this.newsletterService
      .deleteNewsletter(this.projectUid(), id)
      .pipe(
        take(1),
        finalize(() => this.deletingId.set(null))
      )
      .subscribe({
        next: () => {
          this.newsletters.update((current) => current.filter((n) => n.id !== id));
          this.messageService.add({ severity: 'success', summary: 'Draft deleted', detail: 'The draft has been removed.' });
        },
        error: (err: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: err?.error?.message || err?.message || 'Could not delete the draft. Please try again.',
          });
        },
      });
  }

  private initLoadOnContextOrTab(): void {
    combineLatest([toObservable(this.projectUid), toObservable(this.isFoundationContext), toObservable(this.statusTab)])
      .pipe(
        distinctUntilChanged(
          ([prevUid, prevFoundation, prevTab], [uid, foundation, tab]) => prevUid === uid && prevFoundation === foundation && prevTab === tab
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(([uid, foundation, status]) => {
        this.previewVisible.set(false);
        this.selectedNewsletter.set(null);
        if (uid && !foundation) {
          this.loadInitial(status as NewsletterStatus);
        } else {
          this.newsletters.set([]);
          this.nextPageToken.set(undefined);
        }
      });
  }

  private loadInitial(status: NewsletterStatus): void {
    this.loading.set(true);
    this.nextPageToken.set(undefined);
    this.newsletters.set([]);
    this.newsletterService
      .listNewsletters(this.projectUid(), { status })
      .pipe(
        take(1),
        finalize(() => this.loading.set(false))
      )
      .subscribe({
        next: (response) => {
          this.newsletters.set(response.newsletters);
          this.nextPageToken.set(response.next_page_token);
        },
        error: (err: HttpErrorResponse) => this.showLoadError(err),
      });
  }

  private showLoadError(err: HttpErrorResponse): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not load newsletters',
      detail: err?.error?.message || err?.message || 'Please try again later.',
    });
  }
}
