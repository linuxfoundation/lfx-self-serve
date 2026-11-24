// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { LinkedinPostIdentityComponent } from './linkedin-post-identity.component';

describe('LinkedinPostIdentityComponent', () => {
  async function render(isAuthor: boolean, authorName: string | null) {
    await TestBed.configureTestingModule({ imports: [LinkedinPostIdentityComponent] }).compileComponents();
    const fixture = TestBed.createComponent(LinkedinPostIdentityComponent);
    fixture.componentRef.setInput('isAuthor', isAuthor);
    fixture.componentRef.setInput('authorName', authorName);
    const edit = vi.fn();
    const draft = vi.fn();
    fixture.componentInstance.editAndRedraft.subscribe(edit);
    fixture.componentInstance.draftAsMe.subscribe(draft);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const query = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { fixture, query, edit, draft };
  }

  it('stays closed until asked and reports its state to assistive technology', async () => {
    const { fixture, query } = await render(true, 'Example author');
    const toggle = query('mktg-linkedin-identity-change-toggle');
    expect(toggle?.textContent).toContain('Change who this is written as');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(query('mktg-linkedin-identity-change-panel')).toBeNull();
    toggle?.click();
    await fixture.whenStable();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(query('mktg-linkedin-identity-change-panel')).not.toBeNull();
    toggle?.click();
    await fixture.whenStable();
    expect(query('mktg-linkedin-identity-change-panel')).toBeNull();
  });

  it('sends the author to their profile and a new draft, never to another writer’s action', async () => {
    const { fixture, query, edit, draft } = await render(true, 'Example author');
    query('mktg-linkedin-identity-change-toggle')?.click();
    await fixture.whenStable();
    expect(query('mktg-linkedin-identity-change-panel')?.textContent).toContain('your LinkedIn profile');
    expect(query('mktg-linkedin-identity-change-draft')).toBeNull();
    query('mktg-linkedin-identity-change-edit')?.querySelector('button')?.click();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(draft).not.toHaveBeenCalled();
  });

  it.each([
    ['Example author', "Example author's LinkedIn profile"],
    [null, "its author's LinkedIn profile"],
  ])('offers another writer a draft as themselves (author %s)', async (name, expected) => {
    const { fixture, query, edit, draft } = await render(false, name);
    query('mktg-linkedin-identity-change-toggle')?.click();
    await fixture.whenStable();
    const panel = query('mktg-linkedin-identity-change-panel');
    expect(panel?.textContent).toContain(expected);
    expect(panel?.textContent).toContain('Only they can change that profile');
    expect(query('mktg-linkedin-identity-change-edit')).toBeNull();
    query('mktg-linkedin-identity-change-draft')?.querySelector('button')?.click();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
  });
});
