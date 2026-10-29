// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

/**
 * The layout of a modal: a title and optional subtitle, a body, an optional inset band and an actions footer. Make it the root of
 * the content you open with `UiModalService`; the title labels the dialog and the service handles focus, Escape and the backdrop.
 *
 * Project the body as plain content, an inset band with `modalInset` and the buttons with `modalActions`:
 *
 * ```html
 * <lfx-ui-modal heading="Create Committee" subtitle="Committees get their own meetings.">
 *   <input ... />
 *   <div modalInset>Create a mailing list for this committee</div>
 *   <ng-container modalActions><lfx-ui-button variant="outline-neutral">Cancel</lfx-ui-button> ...</ng-container>
 * </lfx-ui-modal>
 * ```
 */
@Component({
  selector: 'lfx-ui-modal',
  imports: [NgTemplateOutlet],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'dialogRef ? null : "dialog"',
    '[attr.aria-modal]': 'dialogRef ? null : "true"',
    '[attr.aria-labelledby]': 'dialogRef ? null : titleId',
    'data-testid': 'ui-modal',
  },
})
export class UiModalComponent {
  /** Title, such as "Delete Project". Title Case, naming the action. */
  public readonly heading = input.required<string>();
  /** One sentence under the title that states the consequence. */
  public readonly subtitle = input<string>('');
  /** `md` is 540px wide, `sm` is 420px for short confirmations. Both shrink to fit the window. */
  public readonly size = input<'sm' | 'md'>('md');
  /** Keeps the title in place while a long body scrolls under it. The actions footer always stays in place. */
  public readonly sticky = input<boolean>(false);
  /** Stretches the one button in the actions footer to the full width. */
  public readonly singleAction = input<boolean>(false);

  private readonly dialogRef = inject(DialogRef, { optional: true });

  /** Id of the title; `UiModalService` points `aria-labelledby` at it. Inside a service-opened modal it derives from the dialog id. */
  protected readonly titleId: string = this.dialogRef ? `${this.dialogRef.id}-title` : inject(_IdGenerator).getId('lfx-ui-modal-title-');
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly bodyClasses: Signal<string> = this.initBodyClasses();
  protected readonly actionsClasses: Signal<string> = this.initActionsClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. Max height leaves 32px above and below, as in the library.
      const base = 'flex max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-ui-lg bg-ui-background-100 shadow-modal';
      return `${base} ${this.size() === 'sm' ? 'w-[420px]' : 'w-[540px]'}`;
    });
  }

  private initBodyClasses(): Signal<string> {
    return computed(() => {
      const base = 'flex min-h-0 flex-1 flex-col gap-[16px] overflow-auto px-[24px] copy-14 text-ui-neutral-900';
      return `${base} ${this.sticky() ? 'pb-[24px]' : 'py-[24px]'}`;
    });
  }

  private initActionsClasses(): Signal<string> {
    return computed(() => {
      const base = 'flex items-center justify-between gap-[12px] border-t border-ui-neutral-alpha-200 bg-ui-background-200 px-[24px] py-[16px] empty:hidden';
      return this.singleAction() ? `${base} [&>*]:flex-1` : base;
    });
  }
}
