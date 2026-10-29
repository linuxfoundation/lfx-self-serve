// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, signal, Signal } from '@angular/core';

import { UiCollapseComponent } from './collapse.component';

/**
 * One heading and section of an accordion. The projected content is the section, so it can hold links, lists or other components.
 * Inside `lfx-ui-collapse` the group owns the open state and size; on its own it works as a single toggle that starts closed.
 * Closed sections are `hidden` (`display: none`), as in the library stylesheet.
 */
@Component({
  selector: 'lfx-ui-collapse-item',
  templateUrl: './collapse-item.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block border-b border-ui-neutral-alpha-200',
    // The static `title` attribute would otherwise stay on the host and show a native tooltip over the whole item.
    '[attr.title]': 'null',
    'data-testid': 'ui-collapse-item',
  },
})
export class UiCollapseItemComponent {
  private static nextId = 0;

  /** Stable value that identifies this item in the group's `[(open)]` list. */
  public readonly value = input.required<string>();
  /** Heading text shown in the trigger button. */
  public readonly title = input.required<string>();

  /** Unique per instance, so trigger and panel ids never collide. */
  protected readonly idPrefix = `lfx-ui-collapse-item-${UiCollapseItemComponent.nextId++}`;

  private readonly group = inject(UiCollapseComponent, { optional: true });
  private readonly standaloneOpen = signal(false);

  protected readonly isOpen: Signal<boolean> = this.initIsOpen();
  protected readonly triggerClasses: Signal<string> = this.initTriggerClasses();
  protected readonly panelClasses: Signal<string> = this.initPanelClasses();

  protected toggle(): void {
    if (this.group) this.group.toggle(this.value());
    else this.standaloneOpen.update((open) => !open);
  }

  private initIsOpen(): Signal<boolean> {
    return computed(() => (this.group ? this.group.isOpen(this.value()) : this.standaloneOpen()));
  }

  private initTriggerClasses(): Signal<string> {
    return computed(() => {
      // Exact px gap and padding, not rem; 14px root.
      const base =
        'flex w-full cursor-pointer items-center justify-between gap-[16px] bg-transparent text-left text-ui-neutral-900 focus-visible:shadow-focus focus-visible:outline-none';
      return this.group?.size() === 'small' ? `${base} label-14 py-[12px] font-medium` : `${base} heading-20 py-[24px]`;
    });
  }

  private initPanelClasses(): Signal<string> {
    return computed(() => {
      // Exact px padding, not rem; 14px root.
      return this.group?.size() === 'small' ? 'copy-14 pb-[12px] text-ui-neutral-600' : 'copy-16 pb-[24px] text-ui-neutral-600';
    });
  }
}
