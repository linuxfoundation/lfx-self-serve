// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FORMATION_PROGRESS_RING_SIZE_CLASSES } from '@lfx-one/shared/constants';
import { FormationProgressRingSize } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { FormationProgressRingComponent } from './formation-progress-ring.component';

describe('FormationProgressRingComponent', () => {
  let fixture: ComponentFixture<FormationProgressRingComponent>;

  const render = async (done: number, total: number, size?: FormationProgressRingSize): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [FormationProgressRingComponent] }).compileComponents();

    fixture = TestBed.createComponent(FormationProgressRingComponent);
    fixture.componentRef.setInput('done', done);
    fixture.componentRef.setInput('total', total);
    if (size !== undefined) {
      fixture.componentRef.setInput('size', size);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const svg = (): SVGElement | null => fixture.nativeElement.querySelector('[data-testid="formation-progress-ring"]');
  const fill = (): SVGElement | null => fixture.nativeElement.querySelector('[data-testid="formation-progress-ring-fill"]');

  afterEach(() => {
    fixture?.destroy();
  });

  it('is decorative: the svg is aria-hidden and unfocusable, so the adjacent text carries the count', async () => {
    await render(1, 4);

    expect(svg()?.getAttribute('aria-hidden')).toBe('true');
    expect(svg()?.getAttribute('focusable')).toBe('false');
  });

  // A round-capped zero-length dash still paints a dot, so "nothing done" must render the track alone.
  it('renders the track without a fill arc at 0 of N', async () => {
    await render(0, 4);

    expect(svg()).not.toBeNull();
    expect(fill()).toBeNull();
  });

  it('renders no fill arc when there is nothing to count', async () => {
    await render(0, 0);

    expect(fill()).toBeNull();
  });

  it('fills the done fraction of a 100-unit path', async () => {
    await render(1, 4);

    expect(fill()?.getAttribute('pathLength')).toBe('100');
    expect(fill()?.getAttribute('stroke-dasharray')).toBe('25 100');
  });

  it('closes the ring when everything is done', async () => {
    await render(4, 4);

    expect(fill()?.getAttribute('stroke-dasharray')).toBe('100 100');
  });

  it('clamps a done count above the total to a closed ring', async () => {
    await render(5, 4);

    expect(fill()?.getAttribute('stroke-dasharray')).toBe('100 100');
  });

  it('sizes the svg through the shared size map, defaulting to md', async () => {
    await render(1, 4);
    for (const token of FORMATION_PROGRESS_RING_SIZE_CLASSES.md.split(' ')) {
      expect(svg()?.classList.contains(token)).toBe(true);
    }

    await render(1, 4, 'sm');
    for (const token of FORMATION_PROGRESS_RING_SIZE_CLASSES.sm.split(' ')) {
      expect(svg()?.classList.contains(token)).toBe(true);
    }
  });
});
