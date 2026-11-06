// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { DialogRef } from '@angular/cdk/dialog';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

import { UiButtonComponent } from '../button/button.component';
import { UiDrawerContext } from './drawer.context';

/**
 * The layout of a drawer: a header with a title, an optional subtitle, your actions and a close button, a scrolling body and an optional
 * footer. Make it the root of the content you open with `UiDrawerService`; the title labels the dialog and the service handles
 * placement, width, focus, Escape, the backdrop and the `canClose` guard. Set `splitFooter` to put the first footer action on the left.
 *
 * Set `bare` (or `UiDrawerConfig.bare`) to drop the header and footer: the title stays for screen readers only, and the content fills an
 * unpadded body that is the only scroller, so it can pin its own header and tabs. Close from the content with `UiDrawerContext.requestClose`.
 *
 * Project the body as plain content, a tile before the title with `drawerLeading`, header actions with `drawerActions` and footer buttons
 * with `drawerFooter`:
 *
 * ```html
 * <lfx-ui-drawer heading="Weekly Sync" subtitle="Technical Steering Committee">
 *   <lfx-ui-avatar drawerLeading shape="rounded" [size]="40" name="Technical Steering Committee" [decorative]="true" />
 *   <ng-container drawerActions><lfx-ui-button variant="secondary">Edit meeting</lfx-ui-button></ng-container>
 *   <p>Agenda…</p>
 *   <ng-container drawerFooter><lfx-ui-button variant="primary" size="large">Save</lfx-ui-button></ng-container>
 * </lfx-ui-drawer>
 * ```
 */
@Component({
  selector: 'lfx-ui-drawer',
  imports: [CdkScrollable, UiButtonComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[style.--drawer-w]': 'drawerWidth',
    'data-testid': 'ui-drawer',
  },
})
export class UiDrawerComponent {
  private readonly dialogRef = inject(DialogRef, { optional: true });
  /** Placement, width and close handling from `UiDrawerService`, or the defaults when the layout is rendered on its own. */
  protected readonly context: UiDrawerContext = inject(UiDrawerContext, { optional: true }) ?? new UiDrawerContext();

  /** Title of the drawer. It names the dialog for screen readers. */
  public readonly heading = input.required<string>();
  /** One line under the title, such as the foundation a project belongs to. */
  public readonly subtitle = input<string>('');
  /** Puts the first footer action on the left, for a secondary or destructive action; otherwise the actions sit on the right. */
  public readonly splitFooter = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** No header or footer; the content fills an unpadded scrolling body. Also set by `UiDrawerConfig.bare`. Don't project the header or footer slots: they never show. */
  public readonly bare = input<boolean, unknown>(false, { transform: booleanAttribute });

  /** Id of the title; `UiDrawerService` points `aria-labelledby` at it. Inside a service-opened drawer it derives from the dialog id. */
  protected readonly titleId: string = this.dialogRef ? `${this.dialogRef.id}-title` : inject(_IdGenerator).getId('lfx-ui-drawer-title-');
  /** Id of the subtitle; `UiDrawerConfig.describedBy` points the dialog at it. */
  protected readonly subtitleId: string = this.dialogRef ? `${this.dialogRef.id}-subtitle` : inject(_IdGenerator).getId('lfx-ui-drawer-subtitle-');
  /** Value of `--drawer-w`: 75vw when wide, otherwise the width in px. */
  protected readonly drawerWidth: string = this.context.size === 'wide' ? '75vw' : `${this.context.width}px`;
  protected readonly isBare: Signal<boolean> = computed(() => this.bare() || this.context.bare);
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  /** Bare bodies have no padding or gap, so the content owns its own spacing. */
  protected readonly bodyClasses: Signal<string> = computed(() => (this.isBare() ? '' : 'gap-[20px] px-[24px] py-[20px]'));
  /** With `splitFooter`, the first action moves left and the rest stay on the right. */
  protected readonly footerClasses: Signal<string> = computed(() => (this.splitFooter() ? '[&>:first-child]:mr-auto' : ''));

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Never wider than the window less the 8px insets on both sides.
      const base =
        '@container flex h-full w-[min(var(--drawer-w),calc(100vw-16px))] flex-col overflow-hidden rounded-ui-md bg-ui-background-100 forced-colors:border forced-colors:border-[color:CanvasText]';
      const wide = this.context.size === 'wide' ? ' min-w-[min(560px,calc(100vw-16px))]' : '';
      const edge = this.context.side === 'left' ? 'is-left' : 'is-right';
      return `${base}${wide} ${edge}`;
    });
  }
}
