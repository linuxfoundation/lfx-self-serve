// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { NEWSLETTER_INVITE_QUERY_PARAM } from '@lfx-one/shared/constants';
import { MyNewsletter, MyNewsletterFoundation, MyNewsletterFoundationsState, MyNewsletterRow, NewsletterInviteDialogData } from '@lfx-one/shared/interfaces';
import { combinedViewCount, newsletterIssuePath } from '@lfx-one/shared/utils';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, scan, startWith, switchMap } from 'rxjs';

import { NewsletterInviteDialogComponent } from '../components/newsletter-invite-dialog/newsletter-invite-dialog.component';
import { NewsletterInviteLandingComponent } from '../components/newsletter-invite-landing/newsletter-invite-landing.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';

/**
 * Me-lens "My Newsletters" foundation drill-down (`/newsletters/my/:foundationSlug`, #3483): the
 * sent newsletters of one foundation reachable through the user's current committee memberships.
 * Also where a newsletter invite lands (`?invite=<group uid>`) — see NewsletterInviteLandingComponent. Access is membership-derived — the
 * BFF fans out committee-scoped upstream reads that the gateway FGA-checks
 * per request — so joining a group reveals its past newsletters and leaving
 * hides them. Clicking a subject opens the issue's reader permalink (#4979);
 * the reader's breadcrumb links back here.
 */
@Component({
  selector: 'lfx-my-newsletters',
  imports: [
    AvatarComponent,
    ButtonComponent,
    CardComponent,
    DatePipe,
    DecimalPipe,
    EmptyStateComponent,
    InputTextComponent,
    NewsletterInviteLandingComponent,
    ReactiveFormsModule,
    RouterLink,
    SelectComponent,
    SkeletonModule,
    TableComponent,
    TooltipModule,
    PageHeaderComponent,
  ],
  providers: [DialogService],
  templateUrl: './my-newsletters.component.html',
  styleUrl: './my-newsletters.component.scss',
})
export class MyNewslettersComponent {
  // === Services ===
  private readonly newsletterService = inject(NewsletterService);
  private readonly personaService = inject(PersonaService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retry$ = new BehaviorSubject<void>(undefined);

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    projectFilter: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly searchTerm = signal<string>('');
  protected readonly projectFilter = signal<string | null>(null);

  // === Route Signals ===
  protected readonly foundationSlug: Signal<string> = toSignal(this.route.paramMap.pipe(map((m) => m.get('foundationSlug') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('foundationSlug') ?? '',
  });
  /** Newsletter group uid of an invite this page is the landing of. */
  protected readonly inviteCommitteeUid: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get(NEWSLETTER_INVITE_QUERY_PARAM))), {
    initialValue: null,
  });

  // === Legacy Query Params (`?issue=&project=` links from the retired reader drawer) ===
  protected readonly queryIssueId: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('issue'))), { initialValue: null });
  protected readonly queryProjectSlug: Signal<string | null> = toSignal(this.route.queryParamMap.pipe(map((m) => m.get('project'))), { initialValue: null });

  // === Computed Signals ===
  protected readonly personaLoaded = this.personaService.personaLoaded;
  private readonly state: Signal<MyNewsletterFoundationsState> = this.initState();
  public readonly loading = computed(() => this.state().loading);
  public readonly error = computed(() => this.state().error);
  /** This page's foundation card, when the user receives its newsletters (null for an invitee not on the list yet). */
  protected readonly foundation: Signal<MyNewsletterFoundation | null> = this.initFoundation();
  protected readonly foundationInitial: Signal<string> = computed(() => (this.foundation()?.name ?? '').charAt(0).toUpperCase());
  public readonly myNewsletters: Signal<MyNewsletter[]> = this.initMyNewsletters();
  public readonly complete = computed(() => this.state().data?.complete ?? null);
  public readonly completenessNotice = this.initCompletenessNotice();
  protected readonly projectOptions: Signal<{ label: string; value: string | null }[]> = this.initProjectOptions();
  protected readonly filteredNewsletters: Signal<MyNewsletter[]> = this.initFilteredNewsletters();
  /**
   * `filteredNewsletters()` with each row's permalink path precomputed —
   * the table template reads `row.issuePath` rather than calling a
   * template function per row (frontend-checklist.md § 4).
   */
  protected readonly filteredNewsletterRows: Signal<MyNewsletterRow[]> = computed(() =>
    this.filteredNewsletters().map((newsletter) => ({
      ...newsletter,
      issuePath: this.issuePath(newsletter),
      shareCount: newsletter.share_count ?? null,
      viewCount: combinedViewCount(newsletter.total_opens, newsletter.page_view_count),
    }))
  );
  protected readonly showProjectFilter: Signal<boolean> = computed(() => this.projectOptions().length > 1);
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => !!(this.searchTerm().trim() || this.projectFilter()));

  // === Constructor ===
  public constructor() {
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value ?? ''));

    // Links shared before #4979 opened the issue in a drawer on this page (`?issue=&project=`).
    // Send them to the issue's reader permalink, which decides access itself, replacing the
    // history entry so Back from the reader returns to whatever came before the old link.
    combineLatest([toObservable(this.queryIssueId), toObservable(this.queryProjectSlug)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([issueId, projectSlug]) => {
        if (issueId && projectSlug) {
          void this.router.navigate(['/newsletters', projectSlug, issueId], { replaceUrl: true });
        }
      });
  }

  public onRetry(): void {
    this.retry$.next(undefined);
  }

  protected onInvite(): void {
    const foundation = this.foundation();
    if (!foundation?.can_invite) return;
    this.dialogService.open(NewsletterInviteDialogComponent, {
      header: 'Invite a colleague',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { foundation } satisfies NewsletterInviteDialogData,
    });
  }

  /** The invite was accepted (or the user was already on the list): reload so the new group's issues and Invite show. */
  protected onInviteJoined(): void {
    this.retry$.next(undefined);
  }

  protected onInviteDismissed(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [NEWSLETTER_INVITE_QUERY_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // === Protected Methods ===
  /**
   * Relative permalink path for a row's subject link. `project_slug` is an enrichment field that
   * can fail to resolve upstream; the row then shows its subject as plain text (no reader route).
   */
  protected issuePath(newsletter: MyNewsletter): string | null {
    return newsletter.project_slug ? newsletterIssuePath(newsletter.project_slug, newsletter.id) : null;
  }

  /** True for a modified click (new-tab intent) that the browser, not this component, should handle. */
  protected isModifiedClick(event: MouseEvent): boolean {
    return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  }

  /**
   * Row click: a pointer convenience on top of the subject link, which is the accessible control
   * (real link role, native Enter, Cmd-click and right-click "Open in new tab"). The link stops its
   * own click from bubbling here, so a click on it navigates once. A modified click elsewhere on the
   * row is a no-op rather than a same-tab navigation.
   */
  protected onRowClick(event: MouseEvent, newsletter: MyNewsletterRow): void {
    if (!newsletter.issuePath || this.isModifiedClick(event)) {
      return;
    }
    void this.router.navigateByUrl(newsletter.issuePath);
  }

  protected onProjectFilterChange(value: string | null): void {
    this.projectFilter.set(value);
  }

  protected resetFilters(): void {
    this.searchForm.reset({ search: '', projectFilter: null }, { emitEvent: false });
    this.searchTerm.set('');
    this.projectFilter.set(null);
  }

  // === Private Initializers ===
  private initCompletenessNotice(): Signal<string> {
    return computed(() => {
      return !this.loading() && !this.error() && this.complete() === false ? 'Some newsletters could not be loaded' : '';
    });
  }

  private initState(): Signal<MyNewsletterFoundationsState> {
    const pending: MyNewsletterFoundationsState = { loading: true, error: false, data: null };
    return toSignal(
      this.retry$.pipe(
        switchMap(() =>
          this.newsletterService.getMyNewsletterFoundations().pipe(
            map((data): MyNewsletterFoundationsState => ({ loading: false, error: false, data })),
            catchError((error: unknown) => {
              console.error('[MyNewsletters] Failed to load newsletters', error);
              return of<MyNewsletterFoundationsState>({ loading: false, error: true, data: null });
            }),
            startWith(pending)
          )
        ),
        // Keep the previous rows on screen while a retry loads.
        scan((previous, next) => (next.loading ? { ...next, data: previous.data } : next), pending)
      ),
      { initialValue: pending }
    );
  }

  private initFoundation(): Signal<MyNewsletterFoundation | null> {
    return computed(() => {
      const slug = this.foundationSlug();
      return this.state().data?.foundations.find((entry) => entry.slug === slug || entry.uid === slug) ?? null;
    });
  }

  private initMyNewsletters(): Signal<MyNewsletter[]> {
    return computed(() => {
      const foundation = this.foundation();
      if (!foundation) return [];
      return (this.state().data?.newsletters ?? []).filter((row) => (row.foundation_uid ?? row.project_uid) === foundation.uid);
    });
  }

  private initProjectOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const seen = new Map<string, string>();
      for (const item of this.myNewsletters()) {
        if (item.is_foundation === false && item.project_uid && !seen.has(item.project_uid)) {
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
      let filtered = this.myNewsletters();

      if (term) {
        filtered = filtered.filter((n) => n.subject.toLowerCase().includes(term) || (n.project_name ?? '').toLowerCase().includes(term));
      }
      if (project) {
        filtered = filtered.filter((n) => n.project_uid === project);
      }

      return filtered;
    });
  }
}
