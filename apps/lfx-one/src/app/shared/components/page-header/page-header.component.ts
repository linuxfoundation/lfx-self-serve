// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

/**
 * The one page header for every lens page: an optional eyebrow, the page title and an optional description.
 * Owns no outer margin; the page sets the gap below it. Rich slots:
 * - `[pageHeaderTitleSuffix]` sits inline after the title (e.g. a tier tag)
 * - `[pageHeaderDescription]` replaces the `description` input when the copy needs markup; project a `<span>`
 *   or `<div>`, since a class-less `<p>` picks up the base layer's `text-base`
 * - `[pageHeaderActions]` sits on the right from `sm` up (buttons, filters)
 */
@Component({
  selector: 'lfx-page-header',
  templateUrl: './page-header.component.html',
  host: { class: 'block' },
})
export class PageHeaderComponent {
  public readonly title = input.required<string>();
  public readonly description = input<string | null | undefined>(undefined);
  public readonly eyebrow = input<string | null | undefined>(undefined);
  public readonly titleTestId = input<string | undefined>(undefined);
  public readonly descriptionTestId = input<string | undefined>(undefined);

  protected readonly titleId = computed(() => this.titleTestId() ?? 'page-header-title');
  protected readonly descriptionId = computed(() => this.descriptionTestId() ?? 'page-header-description');
}
