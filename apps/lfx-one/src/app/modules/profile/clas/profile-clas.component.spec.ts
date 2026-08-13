// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';
import { MenuItem } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileClasComponent } from './profile-clas.component';

describe('ProfileClasComponent', () => {
  const agreement = (overrides: Partial<MyClaAgreement> = {}): MyClaAgreement => ({
    id: 's1',
    kind: 'ICLA',
    claGroupName: 'Project One',
    signedOn: '2022-01-01',
    status: 'valid',
    pdfAvailable: true,
    ...overrides,
  });

  let fixture: ComponentFixture<ProfileClasComponent>;

  async function render(agreements: MyClaAgreement[]): Promise<void> {
    const response: MyClasResponse = {
      agreements,
      identity: { matchedUserIds: agreements.length > 0 ? 1 : 0, unmatched: agreements.length === 0, githubLinked: true },
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileClasComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: MyClasService, useValue: { getMyClas: () => of(response), getPdfUrl: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileClasComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function statusTag(id: string): TagComponent {
    const el = fixture.debugElement.query(By.css(`[data-testid="agreement-status-${id}"]`));
    if (!el) throw new Error(`no status tag rendered for ${id}`);
    return el.componentInstance as TagComponent;
  }

  function menuItems(id: string): MenuItem[] {
    const row = fixture.debugElement.query(By.css(`[data-testid="agreement-row-${id}"]`));
    if (!row) throw new Error(`no row rendered for ${id}`);
    const menu = row.query(By.directive(MenuComponent));
    if (!menu) throw new Error(`no row menu rendered for ${id}`);
    return (menu.componentInstance as MenuComponent).model() ?? [];
  }

  function headers(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('th') as NodeListOf<HTMLElement>).map((th) => th.textContent?.trim() ?? '');
  }

  it('renders Valid / Needs attention / Invalidated with the matching severities', async () => {
    await render([
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    expect(statusTag('s-valid').value()).toBe('Valid');
    expect(statusTag('s-valid').severity()).toBe('success');
    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(statusTag('s-attn').severity()).toBe('warn');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
    expect(statusTag('s-inv').severity()).toBe('danger');
  });

  it('renders an invalidated row instead of the empty state', async () => {
    await render([agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false })]);

    expect(fixture.nativeElement.querySelector('[data-testid="my-clas-empty-state"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-row-s-inv"]')).toBeTruthy();
  });

  it('shows the mockup sentence only for a completed Approved List miss', async () => {
    await render([
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-valid', status: 'valid' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
      agreement({ id: 's-icla', kind: 'ICLA', status: 'valid', statusReason: 'not_on_approval_list' }),
    ]);

    const note = fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]') as HTMLElement | null;
    expect(note?.textContent?.trim()).toBe("No longer matches Acme's approval criteria.");
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-valid"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-inv"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-icla"]')).toBeNull();
  });

  it('omits the possessive when a list-miss row has no company name', async () => {
    await render([agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false })]);

    const note = fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]') as HTMLElement | null;
    expect(note?.textContent?.trim()).toBe('No longer matches the approval criteria.');
  });

  it('renders unknown as plain-text em dash, not a tag and not the list-miss sentence', async () => {
    await render([
      agreement({ id: 's-unknown', kind: 'ECLA', status: 'unknown', statusReason: 'unknown', pdfAvailable: false, companyName: 'Acme' }),
      agreement({ id: 's-attn', kind: 'ECLA', status: 'needs_attention', statusReason: 'not_on_approval_list', pdfAvailable: false, companyName: 'Acme' }),
    ]);

    const unknown = fixture.nativeElement.querySelector('[data-testid="agreement-status-s-unknown"]') as HTMLElement | null;
    expect(unknown?.textContent?.trim()).toBe('—');
    expect(unknown?.tagName.toLowerCase()).not.toBe('lfx-tag');
    expect(fixture.debugElement.query(By.css('[data-testid="agreement-status-s-unknown"]'))?.componentInstance).not.toBeInstanceOf(TagComponent);
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-unknown"]')).toBeNull();

    expect(statusTag('s-attn').value()).toBe('Needs attention');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-attn"]')?.textContent?.trim()).toBe(
      "No longer matches Acme's approval criteria."
    );
  });

  it('never renders Needs attention or an em dash on an ICLA', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', status: 'valid', pdfAvailable: true }),
      agreement({ id: 's-inv', kind: 'ICLA', status: 'invalidated', pdfAvailable: true }),
    ]);

    expect(statusTag('s-icla').value()).toBe('Valid');
    expect(statusTag('s-inv').value()).toBe('Invalidated');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-s-icla"]')?.textContent).not.toContain('Needs attention');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-s-icla"]')?.textContent?.trim()).not.toBe('—');
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-icla"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="agreement-status-note-s-inv"]')).toBeNull();
  });

  it('lists Project, Type, Status, Signed, then an unlabelled actions column, with no Document column', async () => {
    await render([agreement()]);

    expect(headers()).toEqual(['Project', 'Type', 'Status', 'Signed', '']);
    expect(fixture.nativeElement.textContent).not.toContain('Document');
  });

  it('offers an enabled Download PDF item on an ICLA row with a document', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const items = menuItems('s-icla');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Download PDF');
    expect(items[0].disabled).toBeFalsy();
  });

  it('shows a disabled Covered by Corporate CLA item on an ECLA row', async () => {
    await render([agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, companyName: 'Acme' })]);

    expect(menuItems('s-ecla')).toEqual([expect.objectContaining({ label: 'Covered by Corporate CLA (CCLA)', disabled: true })]);
  });

  it('keeps a stable menu model across change detection so the popup can open on the first click', async () => {
    await render([agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true })]);

    const first = menuItems('s-icla');
    fixture.detectChanges();
    expect(menuItems('s-icla')).toBe(first);
  });

  it('does not render placeholder Invalidate or Request approval items', async () => {
    await render([
      agreement({ id: 's-icla', kind: 'ICLA', pdfAvailable: true }),
      agreement({ id: 's-ecla', kind: 'ECLA', pdfAvailable: false, status: 'needs_attention' }),
      agreement({ id: 's-inv', status: 'invalidated', pdfAvailable: false }),
    ]);

    const labels = ['s-icla', 's-ecla', 's-inv'].flatMap((id) => menuItems(id).map((item) => item.label ?? ''));
    expect(labels.some((label) => /invalidate|request approval/i.test(label))).toBe(false);
  });
});
