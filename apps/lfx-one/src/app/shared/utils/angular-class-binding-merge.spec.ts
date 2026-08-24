// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for docs/reviews/knowledge-base/known-false-positives.md's
 * "[class] binding clobbers a static class attribute" entry — an Angular-version upgrade that
 * ever changed Ivy's merge behavior should fail this test rather than silently invalidating that
 * KB entry (and the review findings it suppresses). Covers both initial render AND the update
 * path (a signal-driven [class] change) — production usages like stat-card-grid.component.html
 * rebind the class expression on every change, so the update path is what's actually relied on,
 * not just the first render.
 */
@Component({
  selector: 'lfx-test-class-binding-merge',
  template: `<div class="static-a static-b" [class]="dynamicClass()" data-testid="class-binding-merge-target"></div>`,
})
class ClassBindingMergeTestComponent {
  public dynamicClass = signal('dynamic-c');
}

describe('Angular [class] binding + static class (Ivy merge behavior)', () => {
  async function render(): Promise<ComponentFixture<ClassBindingMergeTestComponent>> {
    await TestBed.configureTestingModule({ imports: [ClassBindingMergeTestComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ClassBindingMergeTestComponent);
    await fixture.whenStable();
    return fixture;
  }

  function target(fixture: ComponentFixture<ClassBindingMergeTestComponent>): HTMLDivElement {
    return fixture.nativeElement.querySelector('[data-testid="class-binding-merge-target"]');
  }

  it('merges the static class attribute with a [class] binding rather than replacing it', async () => {
    const fixture = await render();
    const el = target(fixture);

    expect(el.classList.contains('static-a')).toBe(true);
    expect(el.classList.contains('static-b')).toBe(true);
    expect(el.classList.contains('dynamic-c')).toBe(true);
  });

  it('keeps the static classes (and drops the old bound class) when the bound expression changes', async () => {
    const fixture = await render();

    fixture.componentInstance.dynamicClass.set('dynamic-d');
    await fixture.whenStable();

    const el = target(fixture);

    expect(el.classList.contains('static-a')).toBe(true);
    expect(el.classList.contains('static-b')).toBe(true);
    expect(el.classList.contains('dynamic-d')).toBe(true);
    expect(el.classList.contains('dynamic-c')).toBe(false);
  });
});
