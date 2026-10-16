// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MarkdownRendererComponent } from './markdown-renderer.component';

describe('MarkdownRendererComponent code blocks', () => {
  let fixture: ComponentFixture<MarkdownRendererComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MarkdownRendererComponent] }).compileComponents();
    fixture = TestBed.createComponent(MarkdownRendererComponent);
  });

  it('keeps the suggested llms.txt fence and its contents, distinct from inline code', async () => {
    fixture.componentRef.setInput('content', 'Keep `llms.txt`.\n\n```llms.txt\n# Synthetic Orbit\n> A synthetic project.\n```');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('pre > code')?.className).toBe('language-llms.txt');
    expect(host.querySelector('pre > code')?.textContent).toBe('# Synthetic Orbit\n> A synthetic project.\n');
    expect(host.querySelector('p > code')?.textContent).toBe('llms.txt');
  });

  it('also preserves a regular JSON fence used in shared-renderer consumers', async () => {
    fixture.componentRef.setInput('content', 'Use `status`.\n\n```json\n{"status":"ready"}\n```');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('pre > code')?.className).toBe('language-json');
    expect(host.querySelector('pre > code')?.textContent).toBe('{"status":"ready"}\n');
    expect(host.querySelector('p > code')?.textContent).toBe('status');
  });
});
