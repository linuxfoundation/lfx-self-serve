// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { UiButtonComponent } from '@shared/uikit/button/button.component';

/** A block of ready-to-copy text with a copy button, a visible "Copied" state and a selection fallback. */
@Component({
  selector: 'lfx-share-kit-copy-card',
  imports: [UiButtonComponent],
  templateUrl: './share-kit-copy-card.component.html',
})
export class ShareKitCopyCardComponent {
  private readonly document = inject(DOCUMENT);

  /** Heading above the text, e.g. the post title. */
  public readonly heading = input<string>('');
  /** The exact text the button copies. Rendered as text, never HTML. */
  public readonly text = input.required<string>();
  /** Button label, e.g. "Copy post". */
  public readonly copyLabel = input<string>('Copy');
  /** Length as the platform counts it; hidden when null. */
  public readonly length = input<number | null>(null);
  /** The platform's character limit, shown beside the length. */
  public readonly limit = input<number | null>(null);
  /** Stable prefix for data-testid attributes. */
  public readonly testId = input<string>('share-kit-copy-card');

  /** Emitted after the text was copied (or selected for manual copy). */
  public readonly copied = output<void>();

  protected readonly status = signal('');
  protected readonly overLimit = computed(() => {
    const length = this.length();
    const limit = this.limit();
    return length !== null && limit !== null && length > limit;
  });

  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    // A copy shortly before navigating away must not leave a timer writing to a destroyed card.
    inject(DestroyRef).onDestroy(() => this.clearStatusTimer());
  }

  protected async copy(textElement: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.showStatus('Copied');
    } catch {
      // Clipboard can be refused (older browsers, embedded views): select the text so the visitor can copy it.
      const selection = this.document.getSelection();
      const range = this.document.createRange();
      range.selectNodeContents(textElement);
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.showStatus('Text selected. Use your device’s copy command.');
    }
    this.copied.emit();
  }

  private showStatus(message: string): void {
    this.status.set(message);
    this.clearStatusTimer();
    this.statusTimer = setTimeout(() => this.status.set(''), 4000);
  }

  private clearStatusTimer(): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }
}
