// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { MarkdownRendererComponent } from './markdown-renderer.component';

describe('MarkdownRendererComponent heading scope', () => {
  it.each([false, true])('nests Markdown headings without changing other callers or source (restricted=%s)', async (restricted) => {
    await TestBed.configureTestingModule({ imports: [MarkdownRendererComponent] }).compileComponents();
    const fixture = TestBed.createComponent(MarkdownRendererComponent);
    const markdown = '# Document\n\n## Section\n\n###### Detail\n\n**Body**';
    fixture.componentRef.setInput('content', markdown);
    fixture.componentRef.setInput('restricted', restricted);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('Document');
    fixture.componentRef.setInput('headingLevelOffset', 1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(fixture.nativeElement.querySelector('h2')?.textContent).toBe('Document');
    expect(fixture.nativeElement.querySelector('h3')?.textContent).toBe('Section');
    expect(fixture.nativeElement.querySelector('h6')?.textContent).toBe('Detail');
    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe('Body');
    expect(fixture.componentInstance.content()).toBe(markdown);
    fixture.componentRef.setInput('headingLevelOffset', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('Document');
    fixture.destroy();
  });
});
