// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, input, model, output, Signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTION_HAS_TITLE_OPTIONS, MENTION_RELEVANCE_OPTIONS, MENTION_SENTIMENT_OPTIONS } from '@lfx-one/shared/constants';
import { capitalizeFirst, formatTag } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';

import type { AuthorOption, SocialListeningOption } from '@lfx-one/shared/interfaces';

/**
 * Social Listening filters panel (LFXV2-3017) — the dropdown that opens from the feed header's
 * Filters button. Ports PCC's filters-panel: static sentiment / relevance / has-title selects, a
 * scope-driven language select, and keywords / tags / authors multiselects with per-group loading
 * skeletons. Author rows render the platform icon + mention count through the multiselect's
 * `itemTemplate` hook. Save-as-View and the bookmark/read filters are deliberately absent
 * (deferred scope — see lfxv2-3002-todo.md §6).
 *
 * State lives in the page container and round-trips through query params; this component only
 * two-way-binds it via `model()`. The `lfx-select` / `lfx-multi-select` wrappers are form-bound,
 * so an internal `filtersForm` bridges the two (form → model via `valueChanges`; model → form via
 * `setValue(..., { emitEvent: false })`, which cannot loop) — the same pattern as the feed header.
 *
 * The panel owns its click-outside backdrop, which writes `visible` directly — that is what makes
 * the open state genuinely two-way. "Clear all" only emits `filtersCleared`; the page performs the
 * reset so the panel and the summary pills row share a single clear path.
 */
@Component({
  selector: 'lfx-filters-panel',
  imports: [ReactiveFormsModule, MultiSelectComponent, SelectComponent, SkeletonModule],
  templateUrl: './filters-panel.component.html',
  styleUrl: './filters-panel.component.scss',
})
export class FiltersPanelComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // === Model signals (two-way bound by the page) ===
  public readonly visible = model(false);
  public readonly selectedSentiment = model.required<string>();
  public readonly selectedRelevance = model.required<string>();
  public readonly selectedLanguage = model.required<string>();
  public readonly selectedHasTitle = model.required<string>();
  public readonly selectedKeywords = model.required<string[]>();
  public readonly selectedTags = model.required<string[]>();
  public readonly selectedAuthors = model.required<string[]>();

  // === Inputs (option lists + per-group loading, fetched lazily by the page) ===
  public readonly languageOptions = input<SocialListeningOption[]>([]);
  public readonly languagesLoading = input(false);
  public readonly availableKeywords = input<string[]>([]);
  public readonly keywordsLoading = input(false);
  public readonly availableTags = input<string[]>([]);
  public readonly tagsLoading = input(false);
  public readonly availableAuthors = input<AuthorOption[]>([]);
  public readonly authorsLoading = input(false);
  public readonly activeFilterCount = input(0);

  // === Outputs ===
  public readonly filtersCleared = output<void>();

  // Neutral defaults — the model→form effects below populate the real values at construction
  // (required models can't be read in field initializers).
  protected readonly filtersForm = this.fb.nonNullable.group({
    sentiment: ['all'],
    relevance: ['all'],
    language: ['all'],
    hasTitle: ['all'],
    keywords: [[] as string[]],
    tags: [[] as string[]],
    authors: [[] as string[]],
  });

  protected readonly sentimentOptions = MENTION_SENTIMENT_OPTIONS;
  protected readonly relevanceOptions = MENTION_RELEVANCE_OPTIONS;
  protected readonly hasTitleOptions = MENTION_HAS_TITLE_OPTIONS;

  // Selected values can fall out of the rescoped option lists (or arrive via URL before the
  // options land) — kept as extra options so the multiselect chips still resolve a label (PCC port).
  protected readonly displayedKeywordOptions: Signal<SocialListeningOption[]> = this.initDisplayedKeywordOptions();
  protected readonly displayedTagOptions: Signal<SocialListeningOption[]> = this.initDisplayedTagOptions();

  private readonly panelContainer = viewChild<ElementRef<HTMLElement>>('panelContainer');

  public constructor() {
    // External state (query-param decode, clear-all, pill removal) pushes into the form;
    // emitEvent: false so the valueChanges bridges below don't echo it back and loop.
    effect(() => this.filtersForm.controls.sentiment.setValue(this.selectedSentiment(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.relevance.setValue(this.selectedRelevance(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.language.setValue(this.selectedLanguage(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.hasTitle.setValue(this.selectedHasTitle(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.keywords.setValue(this.selectedKeywords(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.tags.setValue(this.selectedTags(), { emitEvent: false }));
    effect(() => this.filtersForm.controls.authors.setValue(this.selectedAuthors(), { emitEvent: false }));

    this.filtersForm.controls.sentiment.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedSentiment.set(value));
    this.filtersForm.controls.relevance.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedRelevance.set(value));
    this.filtersForm.controls.language.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedLanguage.set(value));
    this.filtersForm.controls.hasTitle.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedHasTitle.set(value));
    this.filtersForm.controls.keywords.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedKeywords.set(value));
    this.filtersForm.controls.tags.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedTags.set(value));
    this.filtersForm.controls.authors.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.selectedAuthors.set(value));

    // Move focus into the dialog on open (the page only renders the panel while it is open, so
    // mount === open). afterNextRender is browser-only by design — no SSR guard needed.
    afterNextRender(() => this.panelContainer()?.nativeElement.focus());
  }

  /** Emits only — the page resets the predicate so the panel and the pills row share one clear path. */
  protected clearFilters(): void {
    this.filtersCleared.emit();
  }

  private initDisplayedKeywordOptions(): Signal<SocialListeningOption[]> {
    return computed(() => {
      const available = this.availableKeywords();
      const extra = this.selectedKeywords().filter((keyword) => !available.includes(keyword));
      return [...available, ...extra].map((keyword) => ({ label: capitalizeFirst(keyword), value: keyword }));
    });
  }

  private initDisplayedTagOptions(): Signal<SocialListeningOption[]> {
    return computed(() => {
      const available = this.availableTags();
      const extra = this.selectedTags().filter((tag) => !available.includes(tag));
      return [...available, ...extra].map((tag) => ({ label: formatTag(tag), value: tag }));
    });
  }
}
