// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { ConfirmationService, Confirmation } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterPublicationPickerComponent } from './newsletter-publication-picker.component';

const publication = (overrides: Partial<NewsletterPublication> = {}): NewsletterPublication => ({
  id: 'pub-1',
  project_uid: 'p-1',
  name: 'Weekly update',
  committee_uids: [],
  implicit: false,
  created_by: 'tester',
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

describe('NewsletterPublicationPickerComponent', () => {
  let fixture: ComponentFixture<NewsletterPublicationPickerComponent>;
  let listAllPublications: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let emitted: (NewsletterPublication | null)[];
  const control = () =>
    (fixture.componentInstance as unknown as { form: { controls: { publication: { value: string; setValue: (v: string) => void } } } }).form.controls
      .publication;

  beforeEach(async () => {
    listAllPublications = vi.fn(() => of([publication(), publication({ id: 'pub-2', template_key: 'set-b' })]));
    confirm = vi.fn();
    emitted = [];
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicationPickerComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { parent: null } },
        { provide: NewsletterService, useValue: { listAllPublications } },
        { provide: ConfirmationService, useValue: { confirm, requireConfirmation$: of() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterPublicationPickerComponent);
    fixture.componentRef.setInput('projectUid', 'p-1');
    fixture.componentInstance.publicationChange.subscribe((value) => emitted.push(value));
  });

  const render = async (inputs: Record<string, unknown> = {}) => {
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('emits the chosen publication', async () => {
    await render();
    control().setValue('pub-1');
    expect(emitted).toEqual([publication()]);
  });

  it('emits null for the one-off option', async () => {
    await render();
    control().setValue('pub-1');
    control().setValue('');
    expect(emitted.at(-1)).toBeNull();
  });

  it('asks before a template-set publication replaces written content', async () => {
    await render({ hasContent: true, layoutTemplateKey: 'set-a' });
    control().setValue('pub-2');
    expect(emitted).toEqual([]);
    expect(confirm).toHaveBeenCalledOnce();
    (confirm.mock.calls[0][0] as Confirmation).accept?.();
    expect(emitted).toEqual([publication({ id: 'pub-2', template_key: 'set-b' })]);
  });

  it('restores the previous value when the change is rejected', async () => {
    await render({ selected: publication(), hasContent: true, layoutTemplateKey: 'set-a' });
    control().setValue('pub-2');
    (confirm.mock.calls[0][0] as Confirmation).reject?.();
    expect(control().value).toBe('pub-1');
    expect(emitted).toEqual([]);
  });

  it('does not ask when the content is already on that template set', async () => {
    await render({ hasContent: true, layoutTemplateKey: 'set-b' });
    control().setValue('pub-2');
    expect(confirm).not.toHaveBeenCalled();
    expect(emitted).toEqual([publication({ id: 'pub-2', template_key: 'set-b' })]);
  });

  it('applies a preselected publication once loaded', async () => {
    await render({ preselectUid: 'pub-2' });
    expect(emitted).toEqual([publication({ id: 'pub-2', template_key: 'set-b' })]);
  });

  it('asks before a preselected publication removes written content', async () => {
    await render({ preselectUid: 'pub-2', hasContent: true, layoutTemplateKey: 'set-a' });
    expect(emitted).toEqual([]);
    expect(confirm).toHaveBeenCalledOnce();
    (confirm.mock.calls[0][0] as Confirmation).accept?.();
    expect(emitted).toEqual([publication({ id: 'pub-2', template_key: 'set-b' })]);
  });

  it('clears a selection the project does not have', async () => {
    await render({ selected: publication({ id: 'gone' }) });
    expect(emitted).toEqual([null]);
  });

  it('shows a one-off fallback when the list fails', async () => {
    listAllPublications.mockReturnValue(throwError(() => new Error('down')));
    await render();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-publication-picker-error"]')).not.toBeNull();
  });

  const click = (testId: string) => ((fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();

  it('opens the new publication form straight away when nothing is unsaved', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    click('newsletter-publication-picker-new');
    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['p-1', 'publications', 'create'], expect.objectContaining({ queryParamsHandling: 'merge' }));
  });

  it('asks before leaving unsaved work for the publication form, and stays on reject', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render({ selected: publication(), unsavedChanges: true });
    click('newsletter-publication-picker-edit');
    expect(navigate).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledOnce();
    (confirm.mock.calls[0][0] as Confirmation).reject?.();
    expect(navigate).not.toHaveBeenCalled();
    (confirm.mock.calls[0][0] as Confirmation).accept?.();
    expect(navigate).toHaveBeenCalledWith(['p-1', 'publications', 'pub-1', 'edit'], expect.anything());
  });

  it('carries the saved edition back to the form as returnTo', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render({ readOnly: true, selected: publication(), returnToNewsletterUid: 'n-1' });
    click('newsletter-publication-picker-edit');
    expect(navigate).toHaveBeenCalledWith(['p-1', 'publications', 'pub-1', 'edit'], expect.objectContaining({ queryParams: { returnTo: 'n-1' } }));
  });

  it('shows a saved edition read-only without loading the list', async () => {
    await render({ readOnly: true, selected: publication() });
    expect(listAllPublications).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-publication-picker-readonly"]')?.textContent).toContain(
      'Weekly update'
    );
  });
  it('drops the previous project’s selection and list before loading another project', async () => {
    await render({ selected: publication() });
    expect(emitted).toEqual([]);
    const pending = new Subject<NewsletterPublication[]>();
    listAllPublications.mockReturnValue(pending);

    await render({ projectUid: 'p-2' });

    expect(emitted).toEqual([null]);
    expect((fixture.componentInstance as unknown as { options: () => { value: string }[] }).options().map((option) => option.value)).toEqual(['']);
  });

  it('drops a change accepted after the picker turned read-only, and resets the control', async () => {
    await render({ selected: publication(), hasContent: true, layoutTemplateKey: 'set-a' });
    control().setValue('pub-2');
    await render({ readOnly: true });
    (confirm.mock.calls[0][0] as Confirmation).accept?.();
    expect(emitted).toEqual([]);
    expect(control().value).toBe('pub-1');
  });

  it('shows a one-off draft as one-off while it is read-only', async () => {
    await render({ readOnly: true, selected: null });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-publication-picker-readonly"]')?.textContent).toContain(
      'One-off newsletter'
    );
  });
});
