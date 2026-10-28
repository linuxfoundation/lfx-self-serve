// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, Signal, viewChild } from '@angular/core';
import { UiTabItem } from '@lfx-one/shared/interfaces';
import { WriterGrantsService } from '@services/writer-grants.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';

/**
 * Redesigned Home / Me lens meetings page — layout shell only, no data yet (epic #4468).
 * @description Header, tabs bar and a scrolling list area in the centre; Next meeting, Last meeting and
 * Pending RSVPs in a fixed 360px right column. At 1024px and below the right column folds into the centre,
 * above the tabs. Rendered by `MeetingsEntryComponent` behind `MEETINGS_REDESIGN_FLAG`.
 */
@Component({
  selector: 'lfx-meetings-redesign',
  imports: [NgTemplateOutlet, UiButtonComponent, UiTabsComponent, UiSearchInputComponent],
  templateUrl: './meetings-redesign.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingsRedesignComponent {
  private readonly writerGrantsService = inject(WriterGrantsService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly header = viewChild<ElementRef<HTMLElement>>('header');

  /** The user holds a writer grant on at least one project, so they can author meetings somewhere. */
  protected readonly canCreateMeeting: Signal<boolean> = computed(
    () => this.writerGrantsService.hasWriterFoundation() || this.writerGrantsService.hasWriterProject()
  );
  protected readonly tabs: UiTabItem[] = [
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'past', label: 'Past' },
  ];
  protected readonly activeTab = signal<string>('upcoming');
  protected readonly search = signal<string>('');
  /** True once the centre column has scrolled, which is when the header fade shows. */
  protected readonly scrolled = signal<boolean>(false);
  /** Measured header height; the tabs bar sticks right below it. */
  protected readonly headerHeight = signal<number>(0);

  public constructor() {
    afterNextRender(() => {
      const element = this.header()?.nativeElement;
      if (!element) return;
      const observer = new ResizeObserver(() => this.headerHeight.set(element.offsetHeight));
      observer.observe(element);
      this.headerHeight.set(element.offsetHeight);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected onScroll(event: Event): void {
    this.scrolled.set((event.target as HTMLElement).scrollTop > 0);
  }
}
