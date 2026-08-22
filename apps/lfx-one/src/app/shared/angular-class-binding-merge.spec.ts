// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for docs/reviews/knowledge-base/known-false-positives.md's
 * "[class] binding clobbers a static class attribute" entry — an Angular-version upgrade that
 * ever changed Ivy's merge behavior should fail this test rather than silently invalidating that
 * KB entry (and the review findings it suppresses).
 */
@Component({
  selector: 'lfx-test-class-binding-merge',
  standalone: true,
  template: `<div class="static-a static-b" [class]="dynamicClass"></div>`,
})
class ClassBindingMergeTestComponent {
  public dynamicClass = 'dynamic-c';
}

describe('Angular [class] binding + static class (Ivy merge behavior)', () => {
  it('merges the static class attribute with a [class] binding rather than replacing it', async () => {
    const fixture: ComponentFixture<ClassBindingMergeTestComponent> = TestBed.createComponent(ClassBindingMergeTestComponent);
    await fixture.whenStable();

    const el: HTMLDivElement = fixture.nativeElement.querySelector('div');

    expect(el.classList.contains('static-a')).toBe(true);
    expect(el.classList.contains('static-b')).toBe(true);
    expect(el.classList.contains('dynamic-c')).toBe(true);
  });
});
