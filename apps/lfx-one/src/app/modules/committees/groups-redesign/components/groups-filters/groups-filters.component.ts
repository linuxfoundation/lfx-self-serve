// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, Signal, signal, viewChild } from '@angular/core';
import { GROUPS_HOME_DEFAULT_FILTERS, GROUPS_HOME_FILTERS_PANEL_WIDTH, PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { FilterOption, GroupsHomeFilters, GroupsHomeVotingCounts, UiFocusable } from '@lfx-one/shared/interfaces';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

/**
 * Filters button of the groups page, with the applied-filter count, and its popover.
 * @description The popover edits a draft: nothing applies until Apply, and closing it any other way discards the draft.
 * Reset Filters clears the draft only.
 */
@Component({
  selector: 'lfx-groups-filters',
  imports: [UiButtonComponent, UiBadgeComponent, UiSelectComponent, UiOptionComponent],
  templateUrl: './groups-filters.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
})
export class GroupsFiltersComponent implements UiFocusable {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly button = viewChild(UiButtonComponent);
  private readonly phone = injectIsMobileViewport(PHONE_MEDIA_QUERY);

  /** Foundations, then projects. */
  public readonly scopeOptions = input.required<FilterOption<string>[]>();
  public readonly votingCounts = input.required<GroupsHomeVotingCounts>();
  /** Applied filters; emits only on Apply. */
  public readonly filters = model.required<GroupsHomeFilters>();

  protected readonly draft = signal<GroupsHomeFilters>(GROUPS_HOME_DEFAULT_FILTERS);
  /** The panel width, or the full width of the control on phones. */
  protected readonly panelWidth = signal(GROUPS_HOME_FILTERS_PANEL_WIDTH);
  protected readonly appliedCount: Signal<number> = computed(() => Object.values(this.filters()).filter((value) => value !== null).length);
  protected readonly buttonLabel: Signal<string> = computed(() => (this.appliedCount() ? `Filters, ${this.appliedCount()} applied` : ''));
  protected readonly changed: Signal<boolean> = computed(() => this.draft().scope !== this.filters().scope || this.draft().voting !== this.filters().voting);
  protected readonly draftHasValue: Signal<boolean> = computed(() => this.draft().scope !== null || this.draft().voting !== null);

  public focus(): void {
    this.button()?.focus();
  }

  /** Every open and close of the popover starts from the applied filters, so a closed draft is discarded. */
  protected resetDraft(): void {
    this.draft.set(this.filters());
    this.panelWidth.set(this.phone() ? this.host.nativeElement.offsetWidth : GROUPS_HOME_FILTERS_PANEL_WIDTH);
  }

  protected setScope(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, scope: value || null }));
  }

  protected setVoting(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, voting: value === 'enabled' || value === 'disabled' ? value : null }));
  }

  protected clearDraft(): void {
    this.draft.set(GROUPS_HOME_DEFAULT_FILTERS);
  }

  protected apply(close: () => void): void {
    this.filters.set(this.draft());
    close();
  }
}
