// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';

/** One ResizeObserver for every meetings home row instead of one per row; does nothing during server rendering. */
@Injectable({ providedIn: 'root' })
export class MeetingsHomeResizeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly callbacks = new Map<Element, () => void>();
  private observer: ResizeObserver | null = null;

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  /** Calls `onResize` whenever one of `elements` changes size; returns the function that stops watching them. */
  public observe(elements: Element[], onResize: () => void): () => void {
    if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return () => undefined;
    this.observer ??= new ResizeObserver((entries) => new Set(entries.map((entry) => this.callbacks.get(entry.target))).forEach((callback) => callback?.()));
    for (const element of elements) {
      this.callbacks.set(element, onResize);
      this.observer.observe(element);
    }
    return () =>
      elements.forEach((element) => {
        this.callbacks.delete(element);
        this.observer?.unobserve(element);
      });
  }
}
