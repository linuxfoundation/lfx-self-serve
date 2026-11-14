// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { revealRowInList } from './reveal-row';

const box = (top: number, height: number): DOMRect => ({ top, bottom: top + height, height }) as DOMRect;

function setup(listBox: DOMRect, rowBox: DOMRect, offsetHeight: number, scrollTop = 100): { row: HTMLElement; list: HTMLElement } {
  const list = document.createElement('div');
  const row = document.createElement('div');
  list.getBoundingClientRect = () => listBox;
  row.getBoundingClientRect = () => rowBox;
  Object.defineProperty(list, 'offsetHeight', { value: offsetHeight });
  list.scrollTop = scrollTop;
  return { row, list };
}

describe('revealRowInList', () => {
  it('scrolls up by the gap when the row sits above the list', () => {
    const { row, list } = setup(box(100, 200), box(80, 20), 200);
    revealRowInList(row, list);
    expect(list.scrollTop).toBe(80);
  });

  it('scrolls down by the gap when the row sits below the list', () => {
    const { row, list } = setup(box(100, 200), box(290, 30), 200);
    revealRowInList(row, list);
    expect(list.scrollTop).toBe(120);
  });

  it('leaves a visible row alone', () => {
    const { row, list } = setup(box(100, 200), box(150, 20), 200);
    revealRowInList(row, list);
    expect(list.scrollTop).toBe(100);
  });

  it('divides the gap by the scale when an ancestor is scaled', () => {
    // On screen the list is 100px tall for 200px of layout height: scale 0.5, so a 10px gap is 20px of scrolling.
    const { row, list } = setup(box(100, 100), box(190, 20), 200);
    revealRowInList(row, list);
    expect(list.scrollTop).toBe(120);
  });

  it('assumes no scale while the list has no layout height', () => {
    const { row, list } = setup(box(100, 0), box(110, 10), 0);
    revealRowInList(row, list);
    expect(list.scrollTop).toBe(120);
  });
});
