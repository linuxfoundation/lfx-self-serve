// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { NewsletterComposerBlock, NewsletterLayout } from '@lfx-one/shared/interfaces';
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
          useValue: { ensureLoaded: () => of(null), getBlock, manifest: signal(null), loading: signal(false), error: signal(null) },
        },
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
          },
        },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (v: string) => v, sanitize: (_: unknown, v: string) => v } },
      ],
    });
    fixture = TestBed.createComponent(NewsletterBlockComposerComponent);
    component = fixture.componentInstance;
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
