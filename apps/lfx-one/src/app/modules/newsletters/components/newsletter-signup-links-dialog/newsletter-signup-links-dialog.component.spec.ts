// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Committee } from '@lfx-one/shared/interfaces';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { CommitteeService } from '@services/committee.service';
import { NewsletterService } from '@services/newsletter.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterSignupLinksDialogComponent } from './newsletter-signup-links-dialog.component';

function committee(uid: string, name: string, category: string, over: Partial<Committee> = {}): Committee {
  return { uid, name, category, join_mode: 'open', ...over } as Committee;
}

describe('NewsletterSignupLinksDialogComponent', () => {
  let fixture: ComponentFixture<NewsletterSignupLinksDialogComponent>;
  let copyLink: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let getCommitteesByProjectOrThrow: ReturnType<typeof vi.fn>;
  let getPublicSignupInfo: ReturnType<typeof vi.fn>;

  /** `serverVerdicts` maps group uid → the signup endpoint's `accepting_signups` (or an Error); default mirrors the list. */
  async function render(committees: Observable<Committee[]>, serverVerdicts: Record<string, boolean | Error> = {}): Promise<void> {
    getPublicSignupInfo = vi.fn((_slug: string, uid: string) => {
      const verdict = serverVerdicts[uid];
      if (verdict instanceof Error) {
        return throwError(() => verdict);
      }
      return of({ accepting_signups: verdict ?? true });
    });
    copyLink = vi.fn();
    close = vi.fn();
    getCommitteesByProjectOrThrow = vi.fn(() => committees);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterSignupLinksDialogComponent],
      providers: [
        { provide: CommitteeService, useValue: { getCommitteesByProjectOrThrow } },
        { provide: NewsletterService, useValue: { getPublicSignupInfo } },
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

  it('flags groups the public page would refuse (join mode not open, or voting enabled), with the reason', async () => {
    await render(
      of([
        committee('g1', 'Alpha News', 'Newsletter'),
        committee('g2', 'Beta News', 'Newsletter', { enable_voting: true }),
        committee('g3', 'Gamma News', 'Newsletter', { join_mode: 'invite_only' }),
      ]),
      { g2: false, g3: false }
    );

    const flagged = ['g1', 'g2', 'g3'].map(
      (uid) => !!fixture.nativeElement.querySelector(`[data-testid="newsletter-signup-link-${uid}"] [data-testid="newsletter-signup-link-unavailable"]`)
    );
    expect(flagged).toEqual([false, true, true]);
    const reason = fixture.nativeElement.querySelector('[data-testid="newsletter-signup-link-g3"] [data-testid="newsletter-signup-link-unavailable"]');
    expect(reason?.textContent).toContain('join mode to Open');
  });

  it("trusts the signup endpoint's refusal the list can't explain, and names the business-email setting", async () => {
    await render(of([committee('g1', 'Alpha News', 'Newsletter')]), { g1: false });

    expect(getPublicSignupInfo).toHaveBeenCalledWith('acme', 'g1');
    const reason = fixture.nativeElement.querySelector('[data-testid="newsletter-signup-link-g1"] [data-testid="newsletter-signup-link-unavailable"]');
    expect(reason?.textContent).toContain('business email');
  });

  it('keeps the list-field refusal but never shows an unverified link as accepting when the signup endpoint cannot be read', async () => {
    await render(of([committee('g1', 'Alpha News', 'Newsletter'), committee('g2', 'Beta News', 'Newsletter', { join_mode: 'closed' })]), {
      g1: new Error('boom'),
      g2: new Error('boom'),
    });

    const flagged = ['g1', 'g2'].map(
      (uid) => !!fixture.nativeElement.querySelector(`[data-testid="newsletter-signup-link-${uid}"] [data-testid="newsletter-signup-link-unavailable"]`)
    );
    expect(flagged).toEqual([true, true]);
    const g1 = fixture.nativeElement.querySelector('[data-testid="newsletter-signup-link-g1"] [data-testid="newsletter-signup-link-unavailable"]');
    const g2 = fixture.nativeElement.querySelector('[data-testid="newsletter-signup-link-g2"] [data-testid="newsletter-signup-link-unavailable"]');
    expect(g1?.textContent).toContain("Couldn't confirm");
    expect(g2?.textContent).toContain('join mode to Open');
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
