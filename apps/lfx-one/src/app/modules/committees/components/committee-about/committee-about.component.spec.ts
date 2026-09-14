// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Committee } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommitteeAboutComponent } from './committee-about.component';

/**
 * Covers the three charter empty-value states on the About-tab Charter card, the one piece of
 * genuinely new logic in an otherwise cloned card (LFXV2-2659): never set, set-then-removed
 * (dotted-underline + tooltip), and set-with-link.
 */
function committee(overrides: Partial<Committee> = {}): Committee {
  return {
    uid: 'committee-1',
    name: 'Test Committee',
    category: 'governance',
    enable_voting: false,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_members: 3,
    project_uid: 'project-1',
    ...overrides,
  };
}

describe('CommitteeAboutComponent charter card', () => {
  let fixture: ComponentFixture<CommitteeAboutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommitteeAboutComponent] }).compileComponents();
    fixture = TestBed.createComponent(CommitteeAboutComponent);
  });

  function emptyState(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="committee-about-charter-empty"]');
  }

  function link(): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('[data-testid="committee-about-charter-link"]');
  }

  it('renders plain, undecorated "No charter yet" with no tooltip when charter was never set', async () => {
    fixture.componentRef.setInput('committee', committee());
    await fixture.whenStable();

    const el = emptyState();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('No charter yet');
    expect(el!.className).not.toContain('underline');
    expect(link()).toBeNull();
  });

  it('renders dotted-underline "No charter yet" with a removal tooltip when the charter was set then removed', async () => {
    fixture.componentRef.setInput(
      'committee',
      committee({
        charter: {
          url: '',
          version: 2,
          updated_at: '2026-08-01T00:00:00Z',
          updated_by: { username: 'alice', name: 'Alice Example' },
        },
      })
    );
    await fixture.whenStable();

    const el = emptyState();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('No charter yet');
    expect(el!.className).toContain('underline');
    expect(el!.className).toContain('decoration-dotted');
    expect(link()).toBeNull();
  });

  it('renders the charter as a link, with a "Last updated by" line, when set', async () => {
    fixture.componentRef.setInput(
      'committee',
      committee({
        charter: {
          url: 'https://example.org/governance/charter.pdf',
          version: 1,
          updated_at: '2026-08-01T00:00:00Z',
          updated_by: { username: 'alice', name: 'Alice Example' },
        },
      })
    );
    await fixture.whenStable();

    const el = link();
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBe('https://example.org/governance/charter.pdf');
    expect(el!.textContent).toContain('https://example.org/governance/charter.pdf');
    expect(emptyState()).toBeNull();

    const updatedBy = fixture.nativeElement.querySelector('[data-testid="committee-about-charter-updated-by"]');
    expect(updatedBy).not.toBeNull();
    expect(updatedBy!.textContent).toContain('Alice Example');
  });

  it('still shows the "Last updated by someone on <date>" line when the charter has no updated_by (upstream permits it to be absent)', async () => {
    fixture.componentRef.setInput(
      'committee',
      committee({
        charter: {
          url: 'https://example.org/governance/charter.pdf',
          version: 1,
          updated_at: '2026-08-01T00:00:00Z',
        },
      })
    );
    await fixture.whenStable();

    const updatedBy = fixture.nativeElement.querySelector('[data-testid="committee-about-charter-updated-by"]');
    expect(updatedBy).not.toBeNull();
    expect(updatedBy!.textContent).toContain('Last updated by someone');
  });

  it('shows an "Add charter" edit button when editable and no charter exists', async () => {
    fixture.componentRef.setInput('committee', committee());
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    const btn = fixture.nativeElement.querySelector('[data-testid="committee-about-edit-charter-btn"]');
    expect(btn).not.toBeNull();
  });
});
