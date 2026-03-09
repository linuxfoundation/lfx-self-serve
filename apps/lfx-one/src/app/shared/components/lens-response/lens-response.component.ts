// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { LensBlock } from '@lfx-one/shared/interfaces';

import { MarkdownRendererComponent } from '../markdown-renderer/markdown-renderer.component';

@Component({
  selector: 'lfx-lens-response',
  imports: [MarkdownRendererComponent],
  templateUrl: './lens-response.component.html',
  styleUrl: './lens-response.component.scss',
})
export class LensResponseComponent {
  public readonly content = input<string>('');
  public readonly blocks = input.required<LensBlock[]>();
  public readonly suggestionClick = output<string>();
}
