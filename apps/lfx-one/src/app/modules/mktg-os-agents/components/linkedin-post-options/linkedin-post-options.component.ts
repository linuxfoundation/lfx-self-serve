// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_MISSING_LINK_COPY_NOTICE } from '@lfx-one/shared/constants';
import { LinkedinOption, LinkedinOptionPresentation } from '@lfx-one/shared/interfaces';
import { presentLinkedinOption } from '@lfx-one/shared/utils';

/** Shared read-only presentation for the intake result and its stored document. */
@Component({
  selector: 'lfx-linkedin-post-options',
  imports: [ButtonComponent],
  templateUrl: './linkedin-post-options.component.html',
  styleUrl: './linkedin-post-options.component.scss',
})
export class LinkedinPostOptionsComponent {
  private readonly platform = inject(PLATFORM_ID);

  public readonly options = input.required<LinkedinOption[]>();
  public readonly shareLink = input('');
  public readonly notes = input<string[]>([]);
  public readonly addLinkDisabled = input(false);
  public readonly addLink = output<void>();
  protected readonly copiedContent = signal<LinkedinOptionPresentation | null>(null);
  protected readonly error = signal('');
  protected readonly presented = this.initPresented();
  protected readonly copied = this.initCopied();
  protected readonly notice = computed(() => (this.copied() !== null && this.copiedContent()?.missingLink ? LINKEDIN_MISSING_LINK_COPY_NOTICE : ''));

  protected async onCopy(option: LinkedinOptionPresentation): Promise<void> {
    if (!isPlatformBrowser(this.platform)) return;
    this.copiedContent.set(null);
    this.error.set('');
    try {
      await navigator.clipboard.writeText(option.copyText);
      this.copiedContent.set(option);
    } catch {
      this.error.set('Clipboard unavailable. Select the post text and copy it manually.');
    }
  }

  private initCopied() {
    return computed(() => {
      const copied = this.copiedContent();
      return copied && this.presented().some((option) => option.number === copied.number && option.copyText === copied.copyText) ? copied.number : null;
    });
  }

  private initPresented() {
    return computed(() => this.options().map((option) => presentLinkedinOption(option, this.shareLink())));
  }
}
