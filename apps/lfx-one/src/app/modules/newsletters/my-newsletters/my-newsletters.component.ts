// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, model, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { MyNewsletter, MyNewsletterRow, MyNewslettersState } from '@lfx-one/shared/interfaces';
import { newsletterIssuePath, toAbsoluteUrl } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, map, of, scan, startWith, switchMap } from 'rxjs';

import { NewsletterPreviewDrawerComponent } from '../components/newsletter-preview-drawer/newsletter-preview-drawer.component';

/**
 * Me-lens "My Newsletters" page: sent newsletters reachable through the
 * user's current committee memberships. Access is membership-derived — the
 * BFF fans out committee-scoped upstream reads that the gateway FGA-checks
 * per request — so joining a group reveals its past newsletters and leaving
 * hides them. Clicking a subject fetches the rendered body via the existing
 * project-scoped get and opens the shared preview drawer.
 */
@Component({
  selector: 'lfx-my-newsletters',
  imports: [
    ButtonComponent,
    CardComponent,
    DatePipe,
    EmptyStateComponent,
    InputTextComponent,
    NewsletterPreviewDrawerComponent,
    ReactiveFormsModule,
    SelectComponent,
    SkeletonModule,
    TableComponent,
    TooltipModule,
  ],
  templateUrl: './my-newsletters.component.html',
  styleUrl: './my-newsletters.component.scss',
})
export class MyNewslettersComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly personaService = inject(PersonaService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly previewVisible = model<boolean>(false);
  /** Newsletter id whose body fetch is in flight — serializes drawer opens. */
  protected readonly openingId = signal<string | null>(null);
  protected readonly selected = signal<MyNewsletter | null>(null);
  protected readonly previewBody = signal<string>('');
  protected readonly searchTerm = signal<string>('');
  protected readonly foundationFilter = signal<string | null>(null);
  protected readonly projectFilter = signal<string | null>(null);

  // === Query Param Signals (for drawer↔URL sync) ===
  protected readonly queryIssueId: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('issue'))), { initialValue: null });
  protected readonly queryProjectSlug: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('project'))), { initialValue: null });

  // === Computed Signals ===
  protected readonly personaLoaded = this.personaService.personaLoaded;
  private readonly state: Signal<MyNewslettersState> = this.initMyNewslettersState();
  public readonly loading = computed(() => this.state().loading);
  public readonly error = computed(() => this.state().error);
  public readonly myNewsletters = computed(() => this.state().newsletters);
  public readonly complete = computed(() => this.state().complete);
  public readonly completenessNotice = this.initCompletenessNotice();
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initFoundationOptions();
  protected readonly projectOptions: Signal<{ label: string; value: string | null }[]> = this.initProjectOptions();
  protected readonly filteredNewsletters: Signal<MyNewsletter[]> = this.initFilteredNewsletters();
  /**
   * `filteredNewsletters()` with each row's permalink path precomputed —
   * the table template reads `row.issuePath` rather than calling a
   * template function per row (frontend-checklist.md § 4).
   */
  protected readonly filteredNewsletterRows: Signal<MyNewsletterRow[]> = computed(() =>
    this.filteredNewsletters().map((newsletter) => ({ ...newsletter, issuePath: this.issuePath(newsletter) }))
  );
  protected readonly showFoundationFilter: Signal<boolean> = computed(() => this.foundationOptions().length > 1);
  protected readonly showProjectFilter: Signal<boolean> = computed(() => this.projectOptions().length > 1);
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => !!(this.searchTerm().trim() || this.foundationFilter() || this.projectFilter()));
  /** Reader-framed drawer subtitle, e.g. "Sent Jul 29, 2026". */
  protected readonly drawerSubtitle: Signal<string> = computed(() => {
    const sentAt = this.selected()?.sent_at;
    return sentAt ? `Sent ${formatDate(sentAt, 'MMM d, y', 'en-US')}` : '';
  });
  /** Canonical permalink for the selected newsletter (SSR-safe absolute URL). */
  protected readonly selectedShareUrl: Signal<string | null> = computed(() => {
    const selected = this.selected();
    if (!selected?.project_slug || !selected.id) return null;
    return toAbsoluteUrl(newsletterIssuePath(selected.project_slug, selected.id), isPlatformBrowser(this.platformId));
  });

  // === Constructor ===
  public constructor() {
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value ?? ''));

    // Drawer ↔ URL sync: open the drawer when `issue`/`project` params are
    // present (page load or forward navigation), close it when they clear
    // (browser back). Idempotent — an emission for an issue that is already
    // open or mid-fetch is a no-op, so the sync never re-triggers a fetch.
    combineLatest([toObservable(this.queryIssueId), toObservable(this.queryProjectSlug), toObservable(this.state)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([issueId, projectSlug, { newsletters, loading, error }]) => {
        if (!issueId || !projectSlug) {
          // Params cleared (drawer close or back navigation) — close the drawer.
          if (this.previewVisible()) {
            this.previewVisible.set(false);
          }
          return;
        }
        // Wait for the feed before deciding; skip if this issue is already opening or open.
        if (loading || error || this.openingId() || (this.previewVisible() && this.selected()?.id === issueId)) {
          return;
        }
        const newsletter = newsletters.find((n) => n.id === issueId && n.project_slug === projectSlug);
        if (newsletter) {
          // Newsletter is in the feed — open the drawer via the normal path
          this.onOpenNewsletter(newsletter);
        } else {
          // Newsletter not in the feed (e.g. non-member pasted a URL).
          // Redirect to the canonical permalink page, which handles access uniformly.
          this.router.navigate(['/newsletters', projectSlug, issueId]);
        }
      });
  }

  public onRetry(): void {
    this.retry$.next(undefined);
  }

  // === Protected Methods ===
  /**
   * Relative permalink href for a row's subject anchor — lets modified clicks,
   * middle-click, and right-click ("Open in new tab") reach the reader page
   * natively. `project_slug` is an enrichment field that can fail to resolve
   * upstream; the anchor omits its `href` in that case (see `onOpenSubject`).
   */
  protected issuePath(newsletter: MyNewsletter): string | null {
    return newsletter.project_slug ? newsletterIssuePath(newsletter.project_slug, newsletter.id) : null;
  }

  /** True for a modified click (new-tab intent) that the browser, not this component, should handle. */
  protected isModifiedClick(event: MouseEvent): boolean {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  protected onOpenNewsletter(newsletter: MyNewsletter): void {
    if (this.openingId()) {
      return;
    }
    this.selected.set(newsletter);
    this.openingId.set(newsletter.id);

    // Update URL with query params (sync drawer open state to URL)
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { issue: newsletter.id, project: newsletter.project_slug },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });

    // The list DTO deliberately omits body_html; fetch the full newsletter via
    // the project-scoped get (open to any authenticated user upstream) and
    // only open the drawer once the rendered body is available.
    this.newsletterService
      .getNewsletter(newsletter.project_uid, newsletter.id)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.openingId.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((full) => {
        if (full?.body_html) {
          this.previewBody.set(full.body_html);
          this.previewVisible.set(true);
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Unable to open newsletter',
            detail: 'Could not load the newsletter content. Please try again.',
          });
        }
      });
  }

  /**
   * Subject-anchor click handler: the anchor is the accessible control (real
   * link role, native Enter/Space, right-click "Open in new tab"/"Copy link
   * address"); stopPropagation keeps the supplementary row click from firing
   * a second open. A modified click (Cmd/Ctrl/Shift/Alt/middle-click) is left
   * to the browser so it opens the permalink in a new tab instead of the drawer.
   */
  protected onOpenSubject(event: MouseEvent, newsletter: MyNewsletter): void {
    event.stopPropagation();
    if (this.isModifiedClick(event)) {
      return;
    }
    event.preventDefault();
    this.onOpenNewsletter(newsletter);
  }

  /** Row click handler: same modified-click guard as the subject anchor, so a Cmd-click anywhere in the row is a no-op rather than opening the drawer with no new tab. */
  protected onRowClick(event: MouseEvent, newsletter: MyNewsletter): void {
    if (this.isModifiedClick(event)) {
      return;
    }
    this.onOpenNewsletter(newsletter);
  }

  protected onDrawerVisibleChange(visible: boolean): void {
    if (visible) {
      return;
    }
    // Drawer closed by the user — clear the issue params so the URL matches.
    // The [(visible)] model binding already reflects the closed state.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { issue: null, project: null },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }

  protected onFoundationFilterChange(value: string | null): void {
    this.foundationFilter.set(value);
    this.projectFilter.set(null);
    this.searchForm.patchValue({ projectFilter: null }, { emitEvent: false });
  }

  protected onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '', foundationFilter: null, projectFilter: null }, { emitEvent: false });
    this.searchTerm.set('');
    this.foundationFilter.set(null);
    this.projectFilter.set(null);
  }

  // === Private Initializers ===
  private initCompletenessNotice(): Signal<string> {
    return computed(() => {
      if (this.loading() || this.error() || this.complete() === true) return '';
      return this.complete() === false ? 'Some newsletters could not be loaded' : "We couldn't verify that this list is complete";
    });
  }

  private initMyNewslettersState(): Signal<MyNewslettersState> {
    const pending: MyNewslettersState = { loading: true, error: false, newsletters: [], complete: null };
    return toSignal(
      this.retry$.pipe(
        switchMap(() =>
          this.newsletterService.getMyNewsletters().pipe(
            map(
              (response): MyNewslettersState => ({
                loading: false,
                error: false,
                newsletters: Array.isArray(response) ? response : response.newsletters,
                complete: Array.isArray(response) ? null : response.complete,
              })
            ),
            catchError((error: unknown) => {
              console.error('[MyNewsletters] Failed to load newsletters', error);
              return of<MyNewslettersState>({ loading: false, error: true, newsletters: [], complete: null });
            }),
            startWith(pending)
          )
        ),
        scan((previous, next) => (next.loading ? { ...next, newsletters: previous.newsletters, complete: previous.complete } : next), pending)
      ),
      { initialValue: pending }
    );
  }

  private initFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const seen = new Map<string, string>();
      for (const item of this.myNewsletters()) {
        if (item.is_foundation === true && item.project_name) {
          seen.set(item.project_uid, item.project_name);
        } else if (item.is_foundation === false && item.parent_is_foundation === true && item.parent_project_uid && item.parent_project_name) {
          seen.set(item.parent_project_uid, item.parent_project_name);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Foundations', value: null }, ...options];
    });
  }

  private initProjectOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const foundation = this.foundationFilter();
      const seen = new Map<string, string>();
      for (const item of this.myNewsletters()) {
        if (item.is_foundation === false && item.project_uid && !seen.has(item.project_uid)) {
          if (foundation && item.parent_project_uid !== foundation) {
            continue;
          }
          seen.set(item.project_uid, item.project_name || item.project_uid);
        }
      }
      const options = [...seen.entries()].map(([uid, name]) => ({ label: name, value: uid })).sort((a, b) => a.label.localeCompare(b.label));
      return [{ label: 'All Projects', value: null }, ...options];
    });
  }

  private initFilteredNewsletters(): Signal<MyNewsletter[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const project = this.projectFilter();
      const foundation = this.foundationFilter();
      let filtered = this.myNewsletters();

      if (term) {
        filtered = filtered.filter((n) => n.subject.toLowerCase().includes(term) || (n.project_name ?? '').toLowerCase().includes(term));
      }
      if (project) {
        filtered = filtered.filter((n) => n.project_uid === project);
      } else if (foundation) {
        filtered = filtered.filter((n) => n.project_uid === foundation || (n.parent_project_uid === foundation && !n.is_foundation));
      }

      return filtered;
    });
  }
}
