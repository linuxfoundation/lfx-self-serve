// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, ElementRef, input, signal, ViewChild } from '@angular/core';

@Component({
  selector: 'lfx-expandable-text',
  imports: [],
  templateUrl: './expandable-text.component.html',
  styleUrl: './expandable-text.component.scss',
})
export class ExpandableTextComponent {
  @ViewChild('contentElement', { static: false }) public contentElement!: ElementRef<HTMLDivElement>;

  public readonly maxHeight = input<number>(300);
  public readonly expandedHeight = input<number | undefined>(undefined);

  public readonly isExpanded = signal(false);
  public readonly needsExpansion = signal(false);
  public readonly isInitialized = signal(false);

  private fullHeight = 0;

  public constructor() {
    afterNextRender(() => {
      this.measureContent();
    });
  }

  public getContentHeight(): string {
    if (!this.isInitialized()) {
      return 'auto';
    }

    if (!this.needsExpansion()) {
      return 'auto';
    }

    if (this.isExpanded()) {
      return this.expandedHeight() ? `${this.expandedHeight()}px` : `${this.fullHeight}px`;
    }

    return `${this.maxHeight()}px`;
  }

  public toggleExpanded(): void {
    this.isExpanded.update((expanded) => !expanded);
  }

  private measureContent(): void {
    if (this.contentElement?.nativeElement) {
      const element = this.contentElement.nativeElement;

      // Temporarily remove height restrictions to measure full content
      element.style.height = 'auto';
      element.style.maxHeight = 'none';

      this.fullHeight = element.scrollHeight;
      const maxHeightPx = this.maxHeight();

      // Check if content exceeds max height
      this.needsExpansion.set(this.fullHeight > maxHeightPx);

      this.isInitialized.set(true);
    }
  }
}
