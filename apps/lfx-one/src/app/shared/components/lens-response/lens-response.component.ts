// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';
import { LensBlock, LensSqlBlock } from '@lfx-one/shared/interfaces';

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

  // Track which SQL blocks have their SQL viewer expanded
  protected readonly expandedSqlBlocks = signal<Set<number>>(new Set());

  protected toggleSqlView(blockIndex: number): void {
    this.expandedSqlBlocks.update((set) => {
      const next = new Set(set);
      if (next.has(blockIndex)) {
        next.delete(blockIndex);
      } else {
        next.add(blockIndex);
      }
      return next;
    });
  }

  protected isSqlExpanded(blockIndex: number): boolean {
    return this.expandedSqlBlocks().has(blockIndex);
  }

  protected isSingleMetric(block: LensSqlBlock): boolean {
    return !!block.result && block.result.rowCount === 1 && block.result.columns.length === 1;
  }

  protected getSingleMetricValue(block: LensSqlBlock): string {
    if (!block.result?.data?.[0]) return '';
    const col = block.result.columns[0];
    const value = block.result.data[0][col];
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    return String(value ?? '');
  }

  protected getSingleMetricLabel(block: LensSqlBlock): string {
    if (!block.result?.columns?.[0]) return '';
    return block.result.columns[0].replace(/_/g, ' ');
  }
}
