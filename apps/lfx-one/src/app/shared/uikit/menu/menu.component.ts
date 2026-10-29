// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenu } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The menu panel: a list of actions that opens from a button. Put it in an `<ng-template>` and open it from the trigger
 * with the CDK directive `[cdkMenuTriggerFor]`. The panel opens below the trigger, start-aligned, and flips to stay in the window.
 * Arrow keys, Home, End and type-ahead move between items; Escape closes it and returns focus to the trigger.
 *
 * ```html
 * <button [cdkMenuTriggerFor]="actions">Actions</button>
 * <ng-template #actions>
 *   <lfx-ui-menu ariaLabel="Project actions">
 *     <lfx-ui-menu-item icon="fa-light fa-pen-to-square" (triggered)="edit()">Edit</lfx-ui-menu-item>
 *     <lfx-ui-menu-separator />
 *     <lfx-ui-menu-item variant="danger" (triggered)="remove()">Delete Project</lfx-ui-menu-item>
 *   </lfx-ui-menu>
 * </ng-template>
 * ```
 */
@Component({
  selector: 'lfx-ui-menu',
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkMenu],
  host: {
    // Exact px, not rem; 14px root. The library's 200px default width has no Tailwind width utility. Scrolls when taller than the window.
    class: 'flex max-h-[calc(100vh-32px)] w-[200px] flex-col overflow-y-auto rounded-ui-md bg-ui-background-100 p-[6px] shadow-menu',
    '[attr.aria-label]': 'ariaLabel() || null',
    'data-testid': 'ui-menu',
  },
})
export class UiMenuComponent {
  /** Accessible name for the menu, such as "Project actions". */
  public readonly ariaLabel = input<string>('');
}
