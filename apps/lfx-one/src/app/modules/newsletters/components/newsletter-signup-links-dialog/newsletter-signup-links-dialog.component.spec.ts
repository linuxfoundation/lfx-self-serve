// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Committee } from '@lfx-one/shared/interfaces';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { CommitteeService } from '@services/committee.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterSignupLinksDialogComponent } from './newsletter-signup-links-dialog.component';

function committee(uid: string, name: string, category: string, over: Partial<Committee> = {}): Committee {
  return { uid, name, category, ...over } as Committee;
}

describe('NewsletterSignupLinksDialogComponent', () => {
  let fixture: ComponentFixture<NewsletterSignupLinksDialogComponent>;
  let copyLink: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let getCommitteesByProjectOrThrow: ReturnType<typeof vi.fn>;

  async function render(committees: Observable<Committee[]>): Promise<void> {
    copyLink = vi.fn();
    close = vi.fn();
    getCommitteesByProjectOrThrow = vi.fn(() => committees);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterSignupLinksDialogComponent],
      providers: [
        { provide: CommitteeService, useValue: { getCommitteesByProjectOrThrow } },
        { provide: ClipboardShareService, useValue: { copyLink } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { projectUid: 'p-uid', projectSlug: 'acme' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewsletterSignupLinksDialogComponent);
    await fixture.whenStable();
  }

  function all(testId: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  }

  it('lists only Newsletter groups, sorted by name, with absolute signup URLs', async () => {
    await render(
      of([committee('g2', 'Zeta News', 'Newsletter'), committee('g3', 'TSC', 'Technical Steering Committee'), committee('g1', 'Alpha News', 'Newsletter')])
    );

    expect(getCommitteesByProjectOrThrow).toHaveBeenCalledWith('p-uid');
    const urls = all('newsletter-signup-link-url').map((span) => span.textContent?.trim());
    expect(urls).toEqual([`${window.location.origin}/projects/acme/newsletter-signup/g1`, `${window.location.origin}/projects/acme/newsletter-signup/g2`]);
  });

  it('copies the selected group link', async () => {
    await render(of([committee('g1', 'Alpha News', 'Newsletter')]));

    all('newsletter-signup-link-copy')[0].querySelector('button')?.click();

    expect(copyLink).toHaveBeenCalledWith(`${window.location.origin}/projects/acme/newsletter-signup/g1`, 'Signup link copied to clipboard.');
  });

  it('flags groups the public page would refuse (voting enabled or business email required)', async () => {
    await render(
      of([
        committee('g1', 'Alpha News', 'Newsletter'),
        committee('g2', 'Beta News', 'Newsletter', { enable_voting: true }),
        committee('g3', 'Gamma News', 'Newsletter', { business_email_required: true }),
      ])
    );

    const flagged = ['g1', 'g2', 'g3'].map(
      (uid) => !!fixture.nativeElement.querySelector(`[data-testid="newsletter-signup-link-${uid}"] [data-testid="newsletter-signup-link-unavailable"]`)
    );
    expect(flagged).toEqual([false, true, true]);
  });

  it('shows the empty state when the project has no Newsletter groups', async () => {
    await render(of([committee('g3', 'TSC', 'Technical Steering Committee')]));

    expect(all('newsletter-signup-links-empty')).toHaveLength(1);
    expect(all('newsletter-signup-links-list')).toHaveLength(0);
  });

  it('shows an error when the groups cannot be loaded', async () => {
    await render(throwError(() => new Error('boom')));

    expect(all('newsletter-signup-links-error')).toHaveLength(1);
  });
});
