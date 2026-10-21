// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PageHeaderComponent } from './page-header.component';

@Component({
  selector: 'lfx-page-header-test-host',
  template: '',
})
class ProjectedHostComponent {}

describe('PageHeaderComponent', () => {
  it('renders the title as an h1 and the description only when given', async () => {
    TestBed.configureTestingModule({ imports: [PageHeaderComponent] });
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentRef.setInput('title', 'My Meetings');
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h1')?.textContent).toBe('My Meetings');
    expect(element.querySelector('[data-testid="page-header-title"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="page-header-description"]')).toBeNull();
    expect(element.querySelector('[data-testid="page-header-eyebrow"]')).toBeNull();

    fixture.componentRef.setInput('description', 'Across all your projects.');
    fixture.componentRef.setInput('eyebrow', 'Marketing kit');
    fixture.componentRef.setInput('titleTestId', 'meetings-title');
    fixture.componentRef.setInput('descriptionTestId', 'meetings-subtitle');
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="meetings-title"]')?.textContent).toBe('My Meetings');
    expect(element.querySelector('[data-testid="meetings-subtitle"]')?.textContent).toBe('Across all your projects.');
    expect(element.querySelector('[data-testid="page-header-eyebrow"]')?.textContent).toBe('Marketing kit');
  });

  it('projects the title suffix, rich description and actions into their slots', async () => {
    TestBed.configureTestingModule({ imports: [ProjectedHostComponent] });
    // Set here because an inline template this long trips component-max-inline-declarations.
    TestBed.overrideComponent(ProjectedHostComponent, {
      set: {
        imports: [PageHeaderComponent],
        template: `<lfx-page-header title="Projected">
          <span pageHeaderTitleSuffix data-testid="suffix">Tag</span>
          <span pageHeaderDescription data-testid="rich-description">Rich copy</span>
          <button pageHeaderActions data-testid="action">Act</button>
        </lfx-page-header>`,
      },
    });
    const fixture = TestBed.createComponent(ProjectedHostComponent);
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('h1')?.parentElement?.querySelector('[data-testid="suffix"]')).not.toBeNull();
    expect(element.querySelector('lfx-page-header')?.hasAttribute('title')).toBe(false);
    expect(element.querySelector('[data-testid="rich-description"]')?.parentElement?.classList).toContain('text-sm');
    expect(element.querySelector('[data-testid="action"]')?.parentElement?.classList).toContain('gap-3');
  });
});
