// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { DialogRef } from '@angular/cdk/dialog';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

import { UiButtonComponent } from '../button/button.component';
import { UiDrawerContext } from './drawer.context';

/**
 * The layout of a drawer: a header with a title, an optional subtitle, your actions and a close button, a scrolling body and an optional
 * footer. Make it the root of the content you open with `UiDrawerService`; the title labels the dialog and the service handles
 * placement, width, focus, Escape, the backdrop and the `canClose` guard.
 *
 * Project the body as plain content, header actions with `drawerActions` and footer buttons with `drawerFooter`:
 *
 * ```html
 * <lfx-ui-drawer heading="Weekly Sync" subtitle="Technical Steering Committee">
 *   <ng-container drawerActions><lfx-ui-button variant="secondary" size="small">Edit meeting</lfx-ui-button></ng-container>
 *   <p>Agenda…</p>
 *   <ng-container drawerFooter><lfx-ui-button variant="primary">Save</lfx-ui-button></ng-container>
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
    '[style.width.px]': 'context.width',
    'data-testid': 'ui-drawer',
  },
})
export class UiDrawerComponent {
  private readonly dialogRef = inject(DialogRef, { optional: true });

  /** Title of the drawer. It names the dialog for screen readers. */
  public readonly heading = input.required<string>();
  /** One line under the title, such as the foundation a project belongs to. */
  public readonly subtitle = input<string>('');

  /** Placement, width and close handling from `UiDrawerService`, or the defaults when the layout is rendered on its own. */
  protected readonly context: UiDrawerContext = inject(UiDrawerContext, { optional: true }) ?? new UiDrawerContext();
  /** Id of the title; `UiDrawerService` points `aria-labelledby` at it. Inside a service-opened drawer it derives from the dialog id. */
  protected readonly titleId: string = this.dialogRef ? `${this.dialogRef.id}-title` : inject(_IdGenerator).getId('lfx-ui-drawer-title-');
  /** Id of the subtitle; `UiDrawerConfig.describedBy` points the dialog at it. */
  protected readonly subtitleId: string = this.dialogRef ? `${this.dialogRef.id}-subtitle` : inject(_IdGenerator).getId('lfx-ui-drawer-subtitle-');
  protected readonly hostClasses: Signal<string> = this.initHostClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Modal material with the radius on the inner edge only; the sheet fills the window at 640px and narrower, so it loses its radius there.
      const base =
        '@container flex h-full max-w-[100vw] flex-col overflow-hidden bg-ui-background-100 shadow-modal max-[640px]:!w-screen max-[640px]:rounded-none';
      const edge = this.context.side === 'left' ? 'rounded-r-ui-lg is-left' : 'rounded-l-ui-lg is-right';
      return `${base} ${edge}`;
    });
  }
}
