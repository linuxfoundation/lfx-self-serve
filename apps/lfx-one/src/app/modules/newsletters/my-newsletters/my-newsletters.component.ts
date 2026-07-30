// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { MyNewsletter } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { PersonaService } from '@services/persona.service';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, debounceTime, distinctUntilChanged, finalize, of } from 'rxjs';

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
  private readonly destroyRef = inject(DestroyRef);

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  // === Writable Signals ===
  protected readonly loading = signal<boolean>(true);
  protected readonly previewVisible = signal<boolean>(false);
  /** Newsletter id whose body fetch is in flight — serializes drawer opens. */
  protected readonly openingId = signal<string | null>(null);
  protected readonly selected = signal<MyNewsletter | null>(null);
  protected readonly previewBody = signal<string>('');
  protected readonly searchTerm = signal<string>('');
  protected readonly foundationFilter = signal<string | null>(null);
  protected readonly projectFilter = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly personaLoaded = this.personaService.personaLoaded;
  protected readonly myNewsletters: Signal<MyNewsletter[]> = this.initMyNewsletters();
  protected readonly foundationOptions: Signal<{ label: string; value: string | null }[]> = this.initFoundationOptions();
  protected readonly projectOptions: Signal<{ label: string; value: string | null }[]> = this.initProjectOptions();
  protected readonly filteredNewsletters: Signal<MyNewsletter[]> = this.initFilteredNewsletters();
  protected readonly showFoundationFilter: Signal<boolean> = computed(() => this.foundationOptions().length > 1);
  protected readonly showProjectFilter: Signal<boolean> = computed(() => this.projectOptions().length > 1);
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => !!(this.searchTerm().trim() || this.foundationFilter() || this.projectFilter()));
  /** Reader-framed drawer subtitle, e.g. "Received Jul 29, 2026". */
  protected readonly drawerSubtitle: Signal<string> = computed(() => {
    const sentAt = this.selected()?.sent_at;
    return sentAt ? `Received ${formatDate(sentAt, 'MMM d, y', 'en-US')}` : '';
  });

  // === Constructor ===
  public constructor() {
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value ?? ''));
  }

  // === Protected Methods ===
  protected onOpenNewsletter(newsletter: MyNewsletter): void {
    if (this.openingId()) {
      return;
    }
    this.selected.set(newsletter);
    this.openingId.set(newsletter.id);

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
   * Subject-button click handler: the button is the accessible control (real
   * role, native Enter/Space); stopPropagation keeps the supplementary row
   * click from firing a second open.
   */
  protected onOpenSubject(event: Event, newsletter: MyNewsletter): void {
    event.stopPropagation();
    this.onOpenNewsletter(newsletter);
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
  private initMyNewsletters(): Signal<MyNewsletter[]> {
    return toSignal(this.newsletterService.getMyNewsletters().pipe(finalize(() => this.loading.set(false))), { initialValue: [] });
  }

  private initFoundationOptions(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const seen = new Map<string, string>();
      for (const item of this.myNewsletters()) {
        if (item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
          seen.set(item.project_uid, item.project_name || item.project_uid);
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
        if (!item.is_foundation && item.project_uid && !seen.has(item.project_uid)) {
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
