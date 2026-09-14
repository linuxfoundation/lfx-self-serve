// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildChartExternalTooltip } from './chart-tooltip.util';

import type { Chart, ChartType, TooltipModel } from 'chart.js';

const TOOLTIP_CARD_CLASS =
  'pointer-events-none fixed z-50 hidden max-h-[calc(100vh-1rem)] overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg';

function domRect(partial: Partial<DOMRect>): DOMRect {
  return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...partial };
}

function tooltipModel(partial: { opacity?: number; caretX?: number; caretY?: number; title?: string[]; dataPoints?: unknown[] }): TooltipModel<ChartType> {
  return { opacity: 1, caretX: 0, caretY: 0, title: [], dataPoints: [], ...partial } as unknown as TooltipModel<ChartType>;
}

function dataPoint(partial: { label?: string; borderColor?: unknown; backgroundColor?: unknown; formattedValue?: string; dataIndex?: number }): unknown {
  return {
    dataset: { label: partial.label, borderColor: partial.borderColor, backgroundColor: partial.backgroundColor },
    formattedValue: partial.formattedValue ?? '0',
    dataIndex: partial.dataIndex ?? 0,
  };
}

// jsdom's getBoundingClientRect returns zeros, so positioning tests stub the canvas rect.
function createHostedCanvas(rect: Partial<DOMRect>): { host: HTMLDivElement; canvas: HTMLCanvasElement } {
  const host = document.createElement('div');
  host.setAttribute('data-chart-tooltip-host', '');
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(domRect(rect));
  host.appendChild(canvas);
  document.body.appendChild(host);
  return { host, canvas };
}

function run(canvas: HTMLCanvasElement, tooltip: TooltipModel<ChartType>, valueSuffix?: string): void {
  buildChartExternalTooltip(valueSuffix === undefined ? undefined : { valueSuffix })({ chart: { canvas } as unknown as Chart, tooltip });
}

function preCreateTip(host: HTMLElement, rect: Partial<DOMRect>): HTMLElement {
  const tip = document.createElement('div');
  tip.setAttribute('data-lfx-tip', '');
  tip.className = TOOLTIP_CARD_CLASS;
  vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue(domRect(rect));
  host.appendChild(tip);
  return tip;
}

describe('buildChartExternalTooltip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('early-returns when document is undefined (SSR)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => run({} as HTMLCanvasElement, tooltipModel({}))).not.toThrow();
  });

  it('no-ops without a data-chart-tooltip-host ancestor', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    run(canvas, tooltipModel({}));
    expect(document.querySelector('[data-lfx-tip]')).toBeNull();
  });

  it('creates the card lazily with the canonical classes, then reuses it', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 10 });
    run(canvas, tooltipModel({ title: ['Jan 2026'] }));
    const tip = host.querySelector<HTMLElement>('[data-lfx-tip]');
    expect(tip).not.toBeNull();
    expect(tip!.className).toBe(TOOLTIP_CARD_CLASS);
    expect(tip!.style.display).toBe('block');

    run(canvas, tooltipModel({ title: ['Feb 2026'] }));
    expect(host.querySelectorAll('[data-lfx-tip]').length).toBe(1);
    expect(host.querySelector('[data-lfx-tip]')).toBe(tip);
  });

  it('hides the card when the tooltip opacity is 0', () => {
    const { host, canvas } = createHostedCanvas({});
    const tip = preCreateTip(host, {});
    tip.style.display = 'block';
    run(canvas, tooltipModel({ opacity: 0 }));
    expect(tip.style.display).toBe('none');
  });

  it('builds the title and one row per data point, omitting the label separator when unlabeled', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 10 });
    run(
      canvas,
      tooltipModel({
        title: ['Jan 2026'],
        dataPoints: [
          dataPoint({ label: 'Project A', borderColor: '#ff0000', formattedValue: '12' }),
          dataPoint({ backgroundColor: ['#00ff00', '#0000ff'], formattedValue: '3', dataIndex: 1 }),
        ],
      })
    );
    const tip = host.querySelector<HTMLElement>('[data-lfx-tip]')!;

    const title = tip.querySelector('p')!;
    expect(title.textContent).toBe('Jan 2026');
    expect(title.className).toBe('whitespace-nowrap text-xs font-semibold text-gray-900');

    const rows = tip.querySelectorAll('div');
    expect(rows.length).toBe(2);

    const labeledDot = rows[0].querySelector('span')!;
    expect(labeledDot.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(rows[0].textContent).toBe('Project A: 12');

    // Array backgroundColor fallback resolves per dataIndex; no label means no ": " separator.
    const unlabeledDot = rows[1].querySelector('span')!;
    expect(unlabeledDot.style.backgroundColor).toBe('rgb(0, 0, 255)');
    expect(rows[1].textContent).toBe('3');
  });

  it('appends valueSuffix to each formatted value', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 10 });
    run(canvas, tooltipModel({ title: ['Jan 2026'], dataPoints: [dataPoint({ label: 'Avg merge time', formattedValue: '12' })] }), ' days');
    const tip = host.querySelector<HTMLElement>('[data-lfx-tip]')!;
    expect(tip.querySelector('strong')!.textContent).toBe('12 days');
  });

  it('measures and positions the lazily created card on first show', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 10 });
    // The tip does not exist until the first run, so stub the prototype; the canvas own-spy still wins.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-lfx-tip') ? domRect({ width: 200, height: 50 }) : domRect({});
    });
    run(canvas, tooltipModel({ caretX: 20, caretY: 30 }));
    const tip = host.querySelector<HTMLElement>('[data-lfx-tip]')!;
    expect(tip.style.left).toBe('42px');
    expect(tip.style.top).toBe('15px');
  });

  it('positions right of the caret when the card fits the viewport', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 10 });
    const tip = preCreateTip(host, { width: 200, height: 50 });
    run(canvas, tooltipModel({ caretX: 20, caretY: 30 }));
    expect(tip.style.left).toBe('42px');
    expect(tip.style.top).toBe('15px');
  });

  it('flips left of the caret when the card would cross the right viewport edge', () => {
    vi.stubGlobal('innerWidth', 300);
    const { host, canvas } = createHostedCanvas({ left: 100, top: 100 });
    const tip = preCreateTip(host, { width: 200, height: 50 });
    run(canvas, tooltipModel({ caretX: 250, caretY: 100 }));
    expect(tip.style.left).toBe('138px');
  });

  it('clamps the card to 8px from the left edge when the flip would overflow it', () => {
    vi.stubGlobal('innerWidth', 300);
    const { host, canvas } = createHostedCanvas({ left: 100, top: 100 });
    const tip = preCreateTip(host, { width: 200, height: 50 });
    run(canvas, tooltipModel({ caretX: 100, caretY: 100 }));
    expect(tip.style.left).toBe('8px');
  });

  it('clamps the card to 8px from the top when the caret sits near the viewport top', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 0 });
    const tip = preCreateTip(host, { width: 200, height: 100 });
    run(canvas, tooltipModel({ caretX: 20, caretY: 5 }));
    expect(tip.style.top).toBe('8px');
  });

  it('clamps the card to 8px from the bottom when the caret sits near the viewport bottom', () => {
    const { host, canvas } = createHostedCanvas({ left: 10, top: 700 });
    const tip = preCreateTip(host, { width: 200, height: 100 });
    run(canvas, tooltipModel({ caretX: 20, caretY: 50 }));
    expect(tip.style.top).toBe('660px');
  });
});
