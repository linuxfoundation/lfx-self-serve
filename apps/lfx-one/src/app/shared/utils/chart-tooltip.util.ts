// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ChartExternalTooltipOptions } from '@lfx-one/shared/interfaces';

import type { Chart, ChartType, TooltipModel } from 'chart.js';

const TOOLTIP_CARD_CLASS =
  'pointer-events-none fixed z-50 hidden max-h-[calc(100vh-1rem)] overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg';

/**
 * Chart.js `external` tooltip factory — white DOM card (no canvas clipping), flips off the right
 * viewport edge, clamps vertically. Requires `data-chart-tooltip-host` on a canvas ancestor; no-ops without it.
 */
export function buildChartExternalTooltip(options?: ChartExternalTooltipOptions): (args: { chart: Chart; tooltip: TooltipModel<ChartType> }) => void {
  return ({ chart, tooltip }) => {
    // Explicit SSR guard: *.util.ts sits outside the ssr-safety rule's path globs.
    if (typeof document === 'undefined') return;

    const host = chart.canvas.closest('[data-chart-tooltip-host]');
    if (!host) return;

    let tip = host.querySelector<HTMLElement>('[data-lfx-tip]');
    if (!tip) {
      tip = document.createElement('div');
      tip.setAttribute('data-lfx-tip', '');
      tip.className = TOOLTIP_CARD_CLASS;
      host.appendChild(tip);
    }

    if (tooltip.opacity === 0) {
      tip.style.display = 'none';
      return;
    }

    tip.replaceChildren();

    const titleEl = document.createElement('p');
    titleEl.className = 'whitespace-nowrap text-xs font-semibold text-gray-900';
    titleEl.textContent = tooltip.title?.[0] ?? '';
    tip.appendChild(titleEl);

    for (const point of tooltip.dataPoints ?? []) {
      const row = document.createElement('div');
      row.className = 'mt-1.5 flex items-center gap-1.5';

      const dot = document.createElement('span');
      dot.className = 'h-2 w-2 shrink-0 rounded-full';
      // Line datasets carry a single borderColor; fall back for datasets that only declare a fill.
      const dotColor = point.dataset.borderColor ?? point.dataset.backgroundColor;
      dot.style.backgroundColor = String(Array.isArray(dotColor) ? dotColor[point.dataIndex] : dotColor);
      row.appendChild(dot);

      const labelEl = document.createElement('span');
      labelEl.className = 'whitespace-nowrap text-xs text-gray-500';
      labelEl.textContent = point.dataset.label ? `${point.dataset.label}: ` : '';

      const valueEl = document.createElement('strong');
      valueEl.className = 'font-semibold text-gray-900';
      valueEl.textContent = `${point.formattedValue}${options?.valueSuffix ?? ''}`;
      labelEl.appendChild(valueEl);
      row.appendChild(labelEl);

      tip.appendChild(row);
    }

    const rect = chart.canvas.getBoundingClientRect();
    tip.style.display = 'block';
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + tooltip.caretX + 12;
    if (left + tipRect.width + 8 > window.innerWidth) {
      left = rect.left + tooltip.caretX - tipRect.width - 12;
    }
    // Mirror the vertical clamp — a flip near either viewport edge can overshoot it.
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    const top = Math.max(8, Math.min(rect.top + tooltip.caretY - tipRect.height / 2, window.innerHeight - tipRect.height - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
}
