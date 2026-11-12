// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { NewsletterComposerBlock, NewsletterLayout, NewsletterTemplateManifest } from '@lfx-one/shared/interfaces';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterManifestService } from '@services/newsletter-manifest.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';

import { NewsletterRendererService } from '../../services/newsletter-renderer.service';

import { NewsletterBlockComposerComponent } from './newsletter-block-composer.component';

/**
 * The Outline's keyboard controls are the ACCESSIBILITY parity for the
 * pointer-only CDK drag handles: a keyboard user must be able to reorder a
 * container's children, unnest a child to the top level, and nest a top-level
 * leaf into an adjacent container. These tests pin that behavior on the block
 * signal directly (the DOM wiring is thin — each button just calls one method).
 *
 * The component runs on the SERVER platform here so the browser-only render
 * effects / manifest fetch stay dormant; only the pure signal mutations run.
 */
describe('NewsletterBlockComposerComponent — Outline keyboard nesting', () => {
  let fixture: ComponentFixture<NewsletterBlockComposerComponent>;
  let component: NewsletterBlockComposerComponent;
  // Configurable per test: undefined => no allowlist (any child allowed).
  let getBlock: ReturnType<typeof vi.fn>;

  const leaf = (id: string, blockType = 'text'): NewsletterComposerBlock => ({ id, block_type: blockType, label: id, isContainer: false, content: {} });
  const container = (id: string, children: NewsletterComposerBlock[]): NewsletterComposerBlock => ({
    id,
    block_type: 'aaif_community',
    label: id,
    isContainer: true,
    content: {},
    children,
  });

  // Access the protected signal + methods without widening the public surface.
  const api = () =>
    component as unknown as { blocks: { set: (b: NewsletterComposerBlock[]) => void; (): NewsletterComposerBlock[] } } & Record<
      string,
      (...args: unknown[]) => unknown
    >;
  const ids = (blocks: NewsletterComposerBlock[]): string[] => blocks.map((b) => b.id);

  beforeEach(() => {
    getBlock = vi.fn().mockReturnValue(undefined);
    TestBed.configureTestingModule({
      imports: [NewsletterBlockComposerComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: NewsletterManifestService,
          useValue: { ensureLoaded: () => of(null), getBlock, manifest: signal(null), loading: signal(false), error: signal(null), templates: signal([]) },
        },
        ConfirmationService,
        { provide: NewsletterService, useValue: {} },
        // initServerRender's debounced pipeline reads activeContextUid() before the
        // platform guard, so the stub must expose it or the timer throws post-assert.
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'p1' } },
        {
          provide: NewsletterRendererService,
          useValue: {
            renderBlock: () => '',
            renderNewsletter: () => '',
            renderWrapperChrome: () => ({ header: '', footer: '' }),
            renderContainerChrome: () => ({ shellClass: '', shellStyle: '', before: '', after: '' }),
            collectEditableFields: () => new Set(),
            collectUrlFields: () => new Map(),
          },
        },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (v: string) => v, sanitize: (_: unknown, v: string) => v } },
      ],
    });
    fixture = TestBed.createComponent(NewsletterBlockComposerComponent);
    component = fixture.componentInstance;
  });

  it('does not save a focus and blur on rich text the canvas shows cleaned, then saves edits and their undo (#5295)', () => {
    api().blocks.set([{ ...leaf('b1'), content: { body: "<p class='ql-align-center'>Hi</p>" } }]);
    const emitted: NewsletterLayout[] = [];
    component.layoutChange.subscribe((l) => emitted.push(l));
    const el = document.createElement('div');
    el.setAttribute('data-nl-field', 'body');
    el.setAttribute('data-nl-richtext', 'true');
    el.innerHTML = '<p>Hi</p>';
    api()['wireEditable'](el, 'b1');

    el.dispatchEvent(new Event('focus'));
    api()['commitInlineEdit'](el, 'b1');
    expect(emitted).toHaveLength(0);

    el.innerHTML = '<p>Hello</p>';
    api()['commitInlineEdit'](el, 'b1');
    el.innerHTML = '<p>Hi</p>';
    api()['commitInlineEdit'](el, 'b1');
    expect(emitted).toHaveLength(2);
  });

  it('strips class and stray targets from pasted rich text before it reaches the page (#5295)', () => {
    (component as unknown as { platformId: string }).platformId = 'browser';
    const original = document.execCommand;
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand as unknown as typeof document.execCommand;
    try {
      const el = document.createElement('div');
      el.setAttribute('data-nl-richtext', 'true');
      const html = '<p class="fixed inset-0">x</p><a href="https://example.com" target="_top">y</a>';
      const data = { getData: (type: string) => (type === 'text/html' ? html : 'xy') } as unknown as DataTransfer;

      api()['insertSanitizedTransfer'](el, 'missing', data);

      expect(execCommand).toHaveBeenCalledWith('insertHTML', false, '<p>x</p><a href="https://example.com">y</a>');
    } finally {
      document.execCommand = original;
    }
  });

  it('does not count stripped attributes as an inline edit, but saves a real one (#5295)', () => {
    api().blocks.set([{ ...leaf('b1'), content: { body: '<p class="ql-align-center">Hi</p>' } }]);
    const emitted: NewsletterLayout[] = [];
    component.layoutChange.subscribe((l) => emitted.push(l));
    const el = document.createElement('div');
    el.setAttribute('data-nl-field', 'body');
    el.setAttribute('data-nl-richtext', 'true');

    el.innerHTML = '<p>Hi</p>';
    api()['commitInlineEdit'](el, 'b1');
    expect(emitted).toHaveLength(0);

    el.innerHTML = '<p>Hello</p>';
    api()['commitInlineEdit'](el, 'b1');
    expect(emitted).toHaveLength(1);
  });

  it('reorders a child within its container (down, then clamps at the ends)', () => {
    api().blocks.set([container('c1', [leaf('a'), leaf('b'), leaf('c')])]);
    let emitted: NewsletterLayout | undefined;
    component.layoutChange.subscribe((l) => (emitted = l));

    api()['moveChildDown']('c1', 0);
    expect(ids(api().blocks()[0].children ?? [])).toEqual(['b', 'a', 'c']);
    expect(emitted).toBeDefined();

    // Down on the last child is a no-op (clamped), not a wrap-around.
    api()['moveChildDown']('c1', 2);
    expect(ids(api().blocks()[0].children ?? [])).toEqual(['b', 'a', 'c']);
  });

  it('unnests a child to the top level, directly after its parent container', () => {
    api().blocks.set([leaf('top'), container('c1', [leaf('a'), leaf('b')])]);
    api()['moveChildOut']('c1', 'a');

    expect(ids(api().blocks())).toEqual(['top', 'c1', 'a']);
    expect(ids(api().blocks()[1].children ?? [])).toEqual(['b']);
  });

  it('nests a top-level leaf into the adjacent container (appended to its children)', () => {
    api().blocks.set([container('c1', [leaf('a')]), leaf('x')]);
    api()['moveBlockIntoContainer'](1);

    expect(ids(api().blocks())).toEqual(['c1']);
    expect(ids(api().blocks()[0].children ?? [])).toEqual(['a', 'x']);
  });

  const nestTargets = () => (component as unknown as { nestTargets(): Map<string, NewsletterComposerBlock> }).nestTargets();

  it('has no nest target for a container or a leaf with no adjacent container', () => {
    api().blocks.set([container('c1', []), leaf('x'), leaf('y')]);
    // c1 is a container — never a nest source.
    expect(nestTargets().get('c1')).toBeUndefined();
    // y has only a leaf before it and nothing after — no target.
    expect(nestTargets().get('y')).toBeUndefined();
    // x sits next to the c1 container — it does have one.
    expect(nestTargets().get('x')).toBe(api().blocks()[0]);
  });

  it('has no nest target when the container allowlist rejects the type', () => {
    getBlock.mockReturnValue({ allowed_block_types: ['image'] });
    api().blocks.set([container('c1', []), leaf('x', 'text')]);
    // 'text' is not in the container's allowlist, so no nest target.
    expect(nestTargets().get('x')).toBeUndefined();
  });

  it('falls through a REJECTING previous container to an accepting next one', () => {
    // c1 (block_type aaif_community) rejects 'text'; c2 accepts anything.
    getBlock.mockImplementation((blockType: string) => (blockType === 'aaif_community' ? { allowed_block_types: ['image'] } : undefined));
    const c2 = container('c2', []);
    c2.block_type = 'open_container';
    api().blocks.set([container('c1', []), leaf('x', 'text'), c2]);
    // A pointer user could drop x into c2; the keyboard control must reach it too.
    expect(nestTargets().get('x')).toBe(c2);
  });
});

/**
 * Starter blocks and the template picker. Runs on the server platform, so the
 * manifest fetch in ngOnInit stays dormant and the private methods are driven
 * directly; ensureLoaded returns the manifest under test.
 */
describe('NewsletterBlockComposerComponent — starter blocks and template picker', () => {
  let fixture: ComponentFixture<NewsletterBlockComposerComponent>;
  let component: NewsletterBlockComposerComponent;
  let confirm: ReturnType<typeof vi.fn>;
  let manifest: NewsletterTemplateManifest;

  const entry = (blockType: string) => ({ block_type: blockType, label: blockType, category: 'Body', schema: {}, template: '' });
  const api = () =>
    component as unknown as {
      blocks: { set: (b: NewsletterComposerBlock[]) => void; (): NewsletterComposerBlock[] };
      selectedTemplateKey: () => string;
      templateForm: { controls: { template: { value: string; setValue: (v: string, o?: unknown) => void } } };
    } & Record<string, (...args: unknown[]) => unknown>;
  const types = (): string[] =>
    api()
      .blocks()
      .map((b) => b.block_type);

  beforeEach(() => {
    manifest = {
      wrapper_key: 'w',
      blocks: [entry('header'), entry('intro'), entry('footer')],
      starter_blocks: [{ block_type: 'intro' }, { block_type: 'missing' }, { block_type: 'header' }],
    } as unknown as NewsletterTemplateManifest;
    TestBed.configureTestingModule({
      imports: [NewsletterBlockComposerComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: NewsletterManifestService,
          useValue: {
            ensureLoaded: () => of(manifest),
            getBlock: () => undefined,
            manifest: signal(null),
            loading: signal(false),
            error: signal(null),
            templates: signal([]),
          },
        },
        ConfirmationService,
        { provide: NewsletterService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'p1' } },
        { provide: NewsletterRendererService, useValue: { collectEditableFields: () => new Set(), renderWrapperChrome: () => '' } },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (v: string) => v, sanitize: (_: unknown, v: string) => v } },
      ],
    });
    fixture = TestBed.createComponent(NewsletterBlockComposerComponent);
    component = fixture.componentInstance;
    confirm = vi.spyOn(TestBed.inject(ConfirmationService), 'confirm') as unknown as ReturnType<typeof vi.fn>;
  });

  it('adds the starter blocks in manifest order, skipping types the palette lacks, and emits once', () => {
    const emitted: NewsletterLayout[] = [];
    component.layoutChange.subscribe((l) => emitted.push(l));

    api()['addStarterBlocks'](manifest);

    expect(types()).toEqual(['intro', 'header']);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].blocks.map((b) => b.block_type)).toEqual(['intro', 'header']);
  });

  it('adds nothing and emits nothing when the manifest has no starters', () => {
    const emitted: NewsletterLayout[] = [];
    component.layoutChange.subscribe((l) => emitted.push(l));

    api()['addStarterBlocks']({ ...manifest, starter_blocks: [] });

    expect(types()).toEqual([]);
    expect(emitted).toHaveLength(0);
  });

  it('hides the template picker when the publication locks the template set', () => {
    const picker = (locked: boolean): Element | null => {
      const f = TestBed.createComponent(NewsletterBlockComposerComponent);
      f.componentRef.setInput('templateLocked', locked);
      f.detectChanges();
      return (f.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-composer-template"]');
    };
    expect(picker(false)).not.toBeNull();
    expect(picker(true)).toBeNull();
  });

  it('resolves the active template: a saved key wins, a saved keyless layout uses the fallback, a new draft the default', () => {
    const resolve = (layout: NewsletterLayout | null): string => {
      const f = TestBed.createComponent(NewsletterBlockComposerComponent);
      f.componentRef.setInput('initialLayout', layout);
      f.componentInstance.ngOnInit();
      return (f.componentInstance as unknown as { selectedTemplateKey: () => string }).selectedTemplateKey();
    };
    expect(resolve({ wrapper_key: 'w', template_key: 'aaif-weekly-agentic', blocks: [] })).toBe('aaif-weekly-agentic');
    expect(resolve({ wrapper_key: 'w', blocks: [] })).toBe('aaif-user-community');
    expect(resolve(null)).toBe('aaif-member');
  });

  it('does not load or save over a layout nested deeper than the editor supports (#5296)', () => {
    const f = TestBed.createComponent(NewsletterBlockComposerComponent);
    f.componentRef.setInput('initialLayout', {
      wrapper_key: 'w',
      template_key: 'aaif-member',
      blocks: [{ block_type: 'card', content: {}, blocks: [{ block_type: 'card', content: {}, blocks: [{ block_type: 'intro', content: {} }] }] }],
    } as NewsletterLayout);
    f.componentInstance.ngOnInit();
    const deep = f.componentInstance as unknown as { blocks: () => NewsletterComposerBlock[]; layoutTooDeep: () => boolean; emit: () => void };
    const emitted: NewsletterLayout[] = [];
    f.componentInstance.layoutChange.subscribe((l) => emitted.push(l));

    expect(deep.layoutTooDeep()).toBe(true);
    expect(deep.blocks()).toEqual([]);
    deep.emit();
    expect(emitted).toEqual([]);
  });

  it('lists the service templates with curated labels, and keeps the active key when the list lacks it', () => {
    const templates = TestBed.inject(NewsletterManifestService).templates as unknown as { set: (t: { key: string; label: string }[]) => void };
    const options = () => (component as unknown as { templateOptions: () => { label: string; value: string }[] }).templateOptions();

    templates.set([
      { key: 'aaif-member', label: 'Aaif Member' },
      { key: 'custom-set', label: 'Custom Set' },
    ]);
    expect(options()).toEqual([
      { label: 'AAIF members (ED weekly)', value: 'aaif-member' },
      { label: 'Custom Set', value: 'custom-set' },
    ]);

    templates.set([]);
    expect(options()).toEqual([{ label: 'AAIF members (ED weekly)', value: 'aaif-member' }]);
  });

  it('switches an empty canvas to the picked template without asking, and seeds its starters', () => {
    api()['onTemplatePicked']('aaif-weekly-agentic');

    expect(confirm).not.toHaveBeenCalled();
    expect(api().selectedTemplateKey()).toBe('aaif-weekly-agentic');
    expect(types()).toEqual(['intro', 'header']);
  });

  it('asks before replacing blocks, and keeps them when the author declines', () => {
    api().blocks.set([{ id: 'b1', block_type: 'intro', label: 'Intro', isContainer: false, content: { body: 'kept' } }]);
    const before = api().selectedTemplateKey();

    api()['onTemplatePicked']('aaif-weekly-agentic');
    expect(confirm).toHaveBeenCalledTimes(1);
    const options = confirm.mock.calls[0][0] as { reject: () => void; accept: () => void };
    options.reject();

    expect(api().selectedTemplateKey()).toBe(before);
    expect(api().templateForm.controls.template.value).toBe(before);
    expect(api().blocks()[0].content['body']).toBe('kept');

    options.accept();
    expect(api().selectedTemplateKey()).toBe('aaif-weekly-agentic');
    expect(types()).toEqual(['intro', 'header']);
  });
});
