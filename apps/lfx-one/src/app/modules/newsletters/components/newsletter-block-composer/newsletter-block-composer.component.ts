// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, input, OnInit, output, PLATFORM_ID, signal, Signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { NEWSLETTER_DEFAULT_TEMPLATE_KEY, NEWSLETTER_SPACING_DEFAULT, NEWSLETTER_SPACING_MARGIN_KEY, NEWSLETTER_SPACING_PADDING_KEY } from '@lfx-one/shared/constants';
import { humanizeFieldKey, isValidUrl } from '@lfx-one/shared/utils';
import {
  NewsletterBlock,
  NewsletterBlockManifestEntry,
  NewsletterBlockPaletteGroup,
  NewsletterComposerBlock,
  NewsletterComposerTab,
  NewsletterComposerTabDef,
  NewsletterComposerToolbarState,
  NewsletterFieldSchema,
  NewsletterLayout,
  NewsletterTemplateInfo,
} from '@lfx-one/shared/interfaces';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';

import { NewsletterBlockFieldsComponent } from '../newsletter-block-fields/newsletter-block-fields.component';
import { NewsletterRendererService } from '../../services/newsletter-renderer.service';

/**
 * Newsletter block-composer — the first increment of the native-Angular,
 * Puck-style block editor (LFXV2-2381).
 *
 * Left: a palette of block types read from the build-time manifest, grouped by
 * category. Right: a canvas that is a CDK drop list of the layout's top-level
 * blocks. Users drag a palette block into the canvas to append it, reorder
 * blocks within the canvas, and remove blocks. The component emits the current
 * `NewsletterLayout` (wrapper_key from the manifest + the canvas blocks).
 *
 * Phase-1 scope: blocks carry an empty `content: {}` — per-field editing lands in
 * a later ticket. Single-level container nesting IS implemented: a container
 * block exposes its own connected drop list, and blocks can be dragged between
 * the palette, the canvas, and any container (a container cannot nest inside
 * another container). See `onChildDrop` / `detachFromSource` / the nested list.
 *
 * SSR: CDK drag-drop is browser-only, so the canvas drag affordances render only
 * after `isPlatformBrowser`. The manifest is fetched browser-side via the loader
 * service.
 *
 * Inline editing (pass 2, LFXV2-2381): the renderer tags single-field text /
 * richtext elements with `data-nl-field` (and `data-nl-richtext`). For the
 * SELECTED block, an after-render effect makes those elements `contentEditable`.
 * On focus the element selects the block; while it's focused the rendered HTML
 * for that block is FROZEN (`editingBlockId`) so a keystroke / a panel edit can
 * never re-render under the caret. On every `input` the element's `textContent`
 * (or `innerHTML` for richtext) is committed into `block.content` and the layout
 * re-emits — live, so the Fields panel mirrors the edit instantly while the
 * frozen canvas keeps the caret. Blur just releases the freeze. A floating dark
 * toolbar tracks the selected block (label +
 * duplicate / delete, plus B/I/U/link when a richtext field has focus). URL /
 * attribute fields stay panel-only — never marked inline-editable.
 */
@Component({
  selector: 'lfx-newsletter-block-composer',
  imports: [DragDropModule, ReactiveFormsModule, InputTextComponent, SelectComponent, NewsletterBlockFieldsComponent],
  templateUrl: './newsletter-block-composer.component.html',
  styleUrl: './newsletter-block-composer.component.scss',
})
export class NewsletterBlockComposerComponent implements OnInit {
  // === Services ===
  private readonly manifestService = inject(NewsletterManifestService);
  private readonly renderer = inject(NewsletterRendererService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  // Optional initial layout to seed the canvas (e.g. editing an existing draft).
  public readonly initialLayout = input<NewsletterLayout | null>(null);
  // Which embedded template set drives the palette. Defaults to the full AAIF
  // set until per-newsletter template selection lands.
  public readonly templateKey = input<string>(NEWSLETTER_DEFAULT_TEMPLATE_KEY);

  // === Outputs ===
  // Emits the current layout whenever the canvas changes.
  public readonly layoutChange = output<NewsletterLayout>();

  // === Forms ===
  // Palette search. Backed by a FormControl (LFX wrappers are FormGroup-bound);
  // `blockSearch` mirrors the control value as a signal for the filter computed.
  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });
  // Block-library picker. Form-bound (LFX select wrappers are FormGroup-bound);
  // the control mirrors `selectedTemplateKey`. Seeded in ngOnInit.
  protected readonly libraryForm = new FormGroup({ library: new FormControl<string>(NEWSLETTER_DEFAULT_TEMPLATE_KEY, { nonNullable: true }) });

  // === Writable Signals ===
  protected readonly isBrowser = signal<boolean>(false);
  // The canvas: the ordered top-level blocks the user has composed.
  protected readonly blocks = signal<NewsletterComposerBlock[]>([]);
  // The currently selected block (top-level or container child), edited in the
  // fields panel. Null when nothing is selected.
  protected readonly selectedBlockId = signal<string | null>(null);
  // The active left-rail tab (Blocks / Outline / AI). Field editing lives in the
  // persistent RIGHT sidebar now, so selecting a block no longer changes this —
  // the Blocks library stays open while you edit the selected block's fields.
  protected readonly activeTab = signal<NewsletterComposerTab>('blocks');
  // The block whose inline contentEditable element currently has focus. While
  // set, that block's rendered HTML is FROZEN (reused from the last render)
  // so a keystroke or a panel edit can never re-render under the caret. Null
  // when nothing is being inline-edited. Browser-only.
  protected readonly editingBlockId = signal<string | null>(null);
  // The floating block toolbar's position + state (null when hidden).
  protected readonly toolbar = signal<NewsletterComposerToolbarState | null>(null);
  // Preview chrome: the viewport the canvas is constrained to (desktop / mobile
  // email widths) and the backdrop behind the email card (light / dark) —
  // Gatewaze parity for previewing how the email reads on each.
  protected readonly previewViewport = signal<'desktop' | 'mobile'>('desktop');
  protected readonly previewBackdrop = signal<'light' | 'dark'>('light');
  // When true, the preview swaps the live canvas for a read-only view of the
  // rendered email HTML (Gatewaze HTML-source parity).
  protected readonly showSource = signal<boolean>(false);
  // Collapse state for the two side panels — collapsing either hands its width
  // back to the center preview (which is otherwise squeezed by the app's own
  // left nav). The left rail's icons stay visible when its panel is collapsed;
  // the right Fields sidebar shrinks to a thin re-open strip.
  protected readonly leftPanelCollapsed = signal<boolean>(false);
  protected readonly fieldsCollapsed = signal<boolean>(false);
  // The block library (embedded template set) the palette + emitted layout use.
  // Seeded in ngOnInit from the saved layout's `template_key`, then the
  // `templateKey` input, then the default. Changing it swaps the palette.
  protected readonly selectedTemplateKey = signal<string>(NEWSLETTER_DEFAULT_TEMPLATE_KEY);

  // The canvas container — the positioned ancestor the floating toolbar is
  // measured against, and the root we scan for `data-nl-field` elements.
  protected readonly canvasRef = viewChild<ElementRef<HTMLElement>>('canvasEl');

  // === Derived Signals (from the manifest service) ===
  protected readonly manifest = this.manifestService.manifest;
  protected readonly manifestLoading = this.manifestService.loading;
  protected readonly manifestError = this.manifestService.error;

  // === Computed Signals ===
  // Manifest blocks grouped by category for the palette rendering.
  protected readonly paletteGroups: Signal<NewsletterBlockPaletteGroup[]> = this.initPaletteGroups();
  // The palette as rendered: the category groups when there's no search, or a
  // single flat "Results" group of matching blocks while searching (Gatewaze
  // block-search parity — match on label or block type).
  protected readonly displayGroups: Signal<NewsletterBlockPaletteGroup[]> = this.initDisplayGroups();
  protected readonly hasBlocks: Signal<boolean> = computed(() => this.blocks().length > 0);
  // The email-card width for the active viewport (Gatewaze uses 682 / 375).
  protected readonly viewportWidth: Signal<number> = computed(() => (this.previewViewport() === 'mobile' ? 375 : 682));
  // The full assembled email HTML (wrapper + all blocks), the same render path a
  // send uses (editMode off, so no inline-edit markers). Browser-only; feeds the
  // HTML-source view and the email-size indicator.
  protected readonly fullHtml: Signal<string> = this.initFullHtml();
  // Byte size of the rendered email, and the Gmail-clipping status derived from
  // it (Gmail clips messages over ~102 KB, warning as it approaches).
  protected readonly emailBytes: Signal<number> = computed(() => {
    const html = this.fullHtml();
    return html ? new TextEncoder().encode(html).length : 0;
  });
  protected readonly emailSizeLabel: Signal<string> = computed(() => `${(this.emailBytes() / 1024).toFixed(1)} KB`);
  protected readonly emailSizeStatus: Signal<'ok' | 'warn' | 'clip'> = computed(() => {
    const bytes = this.emailBytes();
    if (bytes >= GMAIL_CLIP_BYTES) return 'clip';
    if (bytes >= GMAIL_WARN_BYTES) return 'warn';
    return 'ok';
  });
  // One stable drop-list id per container block, so the palette / canvas / other
  // containers can connect to it for cross-list drag-and-drop.
  protected readonly containerListIds: Signal<string[]> = this.initContainerListIds();
  // The palette feeds the canvas and every container drop list (drag a chip in).
  protected readonly paletteConnectedTo: Signal<string[]> = computed(() => [this.canvasListId, ...this.containerListIds()]);
  // The selected block resolved from its id (searches top-level + children).
  protected readonly selectedBlock: Signal<NewsletterComposerBlock | null> = computed(() => {
    const id = this.selectedBlockId();
    return id ? this.findBlock(this.blocks(), id) : null;
  });
  // The manifest field schema for the selected block (drives the fields panel).
  protected readonly selectedSchema: Signal<NewsletterFieldSchema | null> = computed(() => {
    const block = this.selectedBlock();
    if (!block) return null;
    return this.manifestService.getBlock(block.block_type)?.schema ?? null;
  });

  // The left-rail tab definitions (icons + labels). Fields is NOT a tab — it's
  // the always-on right sidebar.
  protected readonly tabs: NewsletterComposerTabDef[] = [
    { id: 'blocks', label: 'Blocks', icon: 'fa-light fa-cube' },
    { id: 'outline', label: 'Outline', icon: 'fa-light fa-list-tree' },
  ];

  // Palette search mirror: when non-empty, the palette collapses its categories
  // into a single flat list of blocks whose label or type matches (Gatewaze
  // block-search parity). Backed by `searchForm` (declared in the Forms slot).
  protected readonly blockSearch: Signal<string> = toSignal(this.searchForm.controls.search.valueChanges, { initialValue: '' });

  // The libraries the picker offers: the loaded catalog, or a single synthesized
  // entry for the active key when the catalog is empty / its endpoint is absent,
  // so the picker always renders the current library.
  protected readonly availableTemplates: Signal<NewsletterTemplateInfo[]> = this.initAvailableTemplates();

  // The wrapper chrome (header above / footer below the blocks), rendered from
  // the manifest's wrapper template. Recomputes when the manifest loads.
  protected readonly wrapperHeader: Signal<SafeHtml> = this.initWrapperHeader();
  protected readonly wrapperFooter: Signal<SafeHtml> = this.initWrapperFooter();

  // Per-block rendered (and trusted) preview HTML, keyed by the block's local
  // id. Recomputes whenever the canvas blocks or the manifest change — i.e. a
  // Fields-panel edit (which patches block.content) re-renders that block.
  protected readonly renderedBlocks: Signal<Map<string, SafeHtml>> = this.initRenderedBlocks();

  // Per-block outer-spacing inline styles, keyed by block id — precomputed so the
  // template reads a map (`blockSpacingStyles().get(id)`) instead of calling a
  // function per change-detection pass.
  protected readonly blockSpacingStyles: Signal<Map<string, Record<string, string>>> = this.initBlockSpacingStyles();

  // Stable drop-list ids.
  protected readonly canvasListId = 'newsletter-composer-canvas-list';
  protected readonly paletteListId = 'newsletter-composer-palette-list';

  // Monotonic counter for unique per-instance block ids (CDK trackBy + child lists).
  private blockIdCounter = 0;

  // Last-rendered HTML per block id. `initRenderedBlocks` reuses the frozen
  // entry for `editingBlockId` so an in-progress inline edit is never wiped by
  // a re-render (keystroke or panel-driven). Plain Map, mutated inside the
  // computed (the computed's own dependency tracking drives recomputation).
  private readonly renderCache = new Map<string, SafeHtml>();

  public constructor() {
    // After every render that touches the selected block, (re)wire its inline
    // contentEditable elements. Browser-only; the canvas skips SSR hydration.
    this.initInlineEditingEffect();
  }

  public ngOnInit(): void {
    this.isBrowser.set(isPlatformBrowser(this.platformId));

    const seed = this.initialLayout();
    // Resolve the active library: the saved layout's key wins (a reopened draft
    // keeps its library), then the bound input, then the default.
    const activeKey = seed?.template_key ?? this.templateKey();
    this.selectedTemplateKey.set(activeKey);
    this.libraryForm.controls.library.setValue(activeKey, { emitEvent: false });

    if (seed?.blocks?.length) {
      this.blocks.set(seed.blocks.map((block) => this.hydrate(block)));
    }

    // Browser-only: fetch the palette manifest for the active library and the
    // catalog of libraries for the picker.
    if (isPlatformBrowser(this.platformId)) {
      this.manifestService.ensureLoaded(activeKey).subscribe();
      this.manifestService.loadTemplates().subscribe();
    }
  }

  // === Protected Methods ===

  /** Append a palette block to the end of the canvas, and select it. */
  protected addBlock(entry: NewsletterBlockManifestEntry): void {
    const block = this.create(entry);
    this.blocks.update((current) => [...current, block]);
    this.selectBlock(block.id);
    this.emit();
  }

  /**
   * Select a block (top-level or container child). Its fields populate the
   * persistent right sidebar; the left rail (Blocks library) is left as-is so
   * the palette stays open while editing.
   */
  protected selectBlock(id: string): void {
    this.selectedBlockId.set(id);
    // Reposition the floating toolbar onto the newly-selected block next frame
    // (after the ring / layout settles). Browser-only.
    this.scheduleToolbarReposition();
  }

  /**
   * Switch the active left-rail tab — or, when the tab is already active, toggle
   * the panel collapsed/expanded (a second click on Blocks/Outline hides the
   * panel to widen the preview; a third re-opens it). Selection persists across
   * tab changes.
   */
  protected setTab(tab: NewsletterComposerTab): void {
    if (this.tabs.find((t) => t.id === tab)?.disabled) return;
    if (this.activeTab() === tab) {
      this.leftPanelCollapsed.update((collapsed) => !collapsed);
    } else {
      this.activeTab.set(tab);
      this.leftPanelCollapsed.set(false);
    }
    // The canvas width changes with the panel — keep the toolbar pinned.
    this.scheduleToolbarReposition();
  }

  /** Collapse / re-open the right-hand Fields sidebar to reclaim preview width. */
  protected toggleFields(): void {
    this.fieldsCollapsed.update((collapsed) => !collapsed);
    this.scheduleToolbarReposition();
  }

  /**
   * Switch the active block library (template). Libraries define different block
   * types, so we load the new library's manifest and KEEP the blocks it
   * supports — the author's compatible content carries over and re-renders in
   * the new template's styling — dropping only blocks the new library doesn't
   * define (the server render hard-fails on an unknown type). The layout
   * re-emits with the new key; a note reports any dropped blocks.
   */
  protected onLibraryChange(key: string): void {
    const current = this.selectedTemplateKey();
    if (!key || key === current) return;

    this.selectedTemplateKey.set(key);

    if (!isPlatformBrowser(this.platformId)) {
      this.emit();
      return;
    }

    // Load the new library's manifest FIRST (its tap sets the manifest signal),
    // then retain the blocks it supports so compatible content survives.
    this.manifestService.ensureLoaded(key).subscribe(() => {
      const dropped = this.retainSupportedBlocks();
      if (dropped > 0) {
        window.alert(`Removed ${dropped} block${dropped === 1 ? '' : 's'} not available in this template; the rest carried over.`);
      }
      this.emit();
    });
  }

  /**
   * Keep only the canvas blocks (and container children) whose block_type exists
   * in the current library's manifest; drop the rest. Returns the number of
   * blocks dropped, and clears the selection when the selected block was one.
   */
  private retainSupportedBlocks(): number {
    const before = this.countBlocks(this.blocks());
    const manifest = this.manifest();
    if (!manifest) {
      this.blocks.set([]);
      this.clearSelectionState();
      return before;
    }
    const supported = new Set(manifest.blocks.map((entry) => entry.block_type));
    const next = this.blocks()
      .filter((block) => supported.has(block.block_type))
      .map((block) => (block.children ? { ...block, children: block.children.filter((child) => supported.has(child.block_type)) } : block));
    this.blocks.set(next);
    const selected = this.selectedBlockId();
    if (selected && !this.findBlock(next, selected)) {
      this.clearSelectionState();
    }
    return before - this.countBlocks(next);
  }

  /** Total blocks including container children. */
  private countBlocks(blocks: NewsletterComposerBlock[]): number {
    return blocks.reduce((total, block) => total + 1 + (block.children?.length ?? 0), 0);
  }

  /** Drop the current block selection + inline-edit + toolbar state. */
  private clearSelectionState(): void {
    this.selectedBlockId.set(null);
    this.editingBlockId.set(null);
    this.toolbar.set(null);
  }

  /**
   * Reorder top-level blocks from the Outline tab (Gatewaze DraggableOutline
   * parity — root blocks only). The outline list contains only the top-level
   * blocks as draggable rows (container children render nested and static), so
   * CDK's indices map 1:1 onto the `blocks` array.
   */
  protected onOutlineDrop(event: CdkDragDrop<NewsletterComposerBlock[]>): void {
    const next = [...this.blocks()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.blocks.set(next);
    this.emit();
  }

  /** True when the given rail tab is the active one. */
  protected isActiveTab(tab: NewsletterComposerTab): boolean {
    return this.activeTab() === tab;
  }

  /** Constrain the preview to a desktop or mobile email width. */
  protected setViewport(viewport: 'desktop' | 'mobile'): void {
    this.previewViewport.set(viewport);
    this.scheduleToolbarReposition();
  }

  /** Toggle the preview backdrop between light and dark. */
  protected toggleBackdrop(): void {
    this.previewBackdrop.update((mode) => (mode === 'light' ? 'dark' : 'light'));
  }

  /** Toggle the read-only HTML-source view of the rendered email. */
  protected toggleSource(): void {
    this.showSource.update((on) => !on);
  }

  /**
   * The outer-spacing inline style for a canvas block, from its reserved
   * `_spacing_padding` / `_spacing_margin` content keys. Empty when both are
   * default — matching gatewaze, which skips the spacing wrapper at `0px`.
   */
  /** True when the given block id is the selected one (for highlighting). */
  protected isSelected(id: string): boolean {
    return this.selectedBlockId() === id;
  }

  /**
   * Swallow anchor navigation inside the live preview. The rendered email HTML
   * contains real `href`s (and inline-editable text now lives INSIDE some of
   * those anchors, e.g. a job title link), so a click would otherwise navigate
   * the editor away. Block selection / inline focus still proceed normally.
   */
  protected onPreviewClick(event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest('a')) {
      event.preventDefault();
    }
  }

  /**
   * Apply edited content to the selected block immutably (top-level or nested),
   * then re-emit the layout. No-op when nothing is selected.
   */
  protected onContentChange(content: Record<string, unknown>): void {
    const id = this.selectedBlockId();
    if (!id) return;
    this.blocks.update((current) => this.patchContent(current, id, content));
    this.emit();
  }

  // === Floating toolbar actions ===

  /**
   * Duplicate the toolbar's block: deep-clone it (fresh ids), insert the copy
   * immediately after the original (top-level or within its container), select
   * it, and re-emit. The Map-based render then picks the clone up automatically.
   */
  protected duplicateSelectedBlock(): void {
    const id = this.toolbar()?.blockId ?? this.selectedBlockId();
    if (!id) return;

    // Top-level block: clone + insert after.
    const topIndex = this.blocks().findIndex((b) => b.id === id);
    if (topIndex !== -1) {
      const clone = this.cloneBlock(this.blocks()[topIndex]);
      const next = [...this.blocks()];
      next.splice(topIndex + 1, 0, clone);
      this.blocks.set(next);
      this.selectBlock(clone.id);
      this.emit();
      return;
    }

    // Container child: clone + insert after within the parent's children.
    for (const parent of this.blocks()) {
      const childIndex = (parent.children ?? []).findIndex((c) => c.id === id);
      if (childIndex === -1) continue;
      const clone = this.cloneBlock(parent.children![childIndex]);
      const children = [...parent.children!];
      children.splice(childIndex + 1, 0, clone);
      this.updateBlock(parent.id, { children });
      this.selectBlock(clone.id);
      this.emit();
      return;
    }
  }

  /** Delete the toolbar's block (top-level or container child). */
  protected deleteSelectedBlock(): void {
    const id = this.toolbar()?.blockId ?? this.selectedBlockId();
    if (!id) return;
    this.toolbar.set(null);
    if (this.blocks().some((b) => b.id === id)) {
      this.removeBlock(id);
      return;
    }
    const parent = this.blocks().find((b) => (b.children ?? []).some((c) => c.id === id));
    if (parent) this.removeChild(parent.id, id);
  }

  /**
   * Apply a rich-text command to the current selection via `document.execCommand`.
   * NOTE: `execCommand` is deprecated, but it remains the pragmatic baseline for
   * a lightweight contentEditable formatter with no editor dependency — the
   * registered fallbacks across browsers are still consistent for bold / italic
   * / underline / createLink. `mousedown` on the toolbar buttons is prevented
   * (template) so focus stays in the contentEditable and the selection survives.
   */
  protected applyFormat(command: 'bold' | 'italic' | 'underline'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.execCommand(command, false);
  }

  /** Prompt for a URL and wrap the current selection in a link (or unlink). */
  protected applyLink(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = window.prompt('Link URL (leave blank to remove)', 'https://');
    if (url === null) return; // cancelled
    const trimmed = url.trim();
    if (trimmed === '') {
      document.execCommand('unlink', false);
      return;
    }
    // Gate the URL through the shared safe-URL check so a `javascript:` / `data:`
    // scheme can't be stored in the richtext (defense-in-depth — the canvas is
    // the author's own content, but the value persists into body_layout).
    if (!isValidUrl(trimmed)) {
      window.alert('Please enter a valid http(s) URL.');
      return;
    }
    document.execCommand('createLink', false, trimmed);
  }

  /**
   * Drop handler for the top-level canvas list. Handles three cases:
   *   - same-list reorder,
   *   - palette-drop-in (new block from a manifest entry),
   *   - transfer of an existing block out of a container into the canvas.
   */
  protected onCanvasDrop(event: CdkDragDrop<NewsletterComposerBlock[]>): void {
    if (event.previousContainer === event.container) {
      const next = [...this.blocks()];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      this.blocks.set(next);
      this.emit();
      return;
    }

    const paletteEntry = this.asPaletteEntry(event);
    if (paletteEntry) {
      const next = [...this.blocks()];
      next.splice(event.currentIndex, 0, this.create(paletteEntry));
      this.blocks.set(next);
      this.emit();
      return;
    }

    // Existing block transferred from a container into the canvas.
    const moved = this.detachFromSource(event);
    if (!moved) return;
    const next = [...this.blocks()];
    next.splice(event.currentIndex, 0, moved);
    this.blocks.set(next);
    this.emit();
  }

  /**
   * Drop handler for a container block's child list. Handles same-list reorder,
   * palette-drop-in, and transfer of an existing block into the container.
   * Container blocks are not allowed to nest inside other containers (single
   * level), so a dragged container is rejected here.
   */
  protected onChildDrop(parentId: string, event: CdkDragDrop<NewsletterComposerBlock[]>): void {
    const parent = this.blocks().find((block) => block.id === parentId);
    if (!parent) return;

    if (event.previousContainer === event.container) {
      const children = [...(parent.children ?? [])];
      moveItemInArray(children, event.previousIndex, event.currentIndex);
      this.updateBlock(parentId, { children });
      this.emit();
      return;
    }

    const paletteEntry = this.asPaletteEntry(event);
    if (paletteEntry) {
      // Don't allow a container to be created inside another container.
      if (paletteEntry.is_container) return;
      const children = [...(parent.children ?? [])];
      children.splice(event.currentIndex, 0, this.create(paletteEntry));
      this.updateBlock(parentId, { children });
      this.emit();
      return;
    }

    // Existing block transferred into this container.
    const dragged = event.item.data as NewsletterComposerBlock | undefined;
    if (!dragged || dragged.isContainer) return;
    const moved = this.detachFromSource(event);
    if (!moved) return;
    const children = [...(this.blocks().find((block) => block.id === parentId)?.children ?? [])];
    children.splice(event.currentIndex, 0, moved);
    this.updateBlock(parentId, { children });
    this.emit();
  }

  /** Remove a top-level block from the canvas. */
  protected removeBlock(id: string): void {
    const removedIds = this.collectIds(this.blocks().filter((block) => block.id === id));
    this.blocks.update((current) => current.filter((block) => block.id !== id));
    this.clearSelectionIfRemoved(removedIds);
    this.emit();
  }

  /** Remove a child block from a container block. */
  protected removeChild(parentId: string, childId: string): void {
    const parent = this.blocks().find((block) => block.id === parentId);
    if (!parent) return;
    const children = (parent.children ?? []).filter((child) => child.id !== childId);
    this.updateBlock(parentId, { children });
    this.clearSelectionIfRemoved([childId]);
    this.emit();
  }

  /** trackBy for the canvas / child lists. */
  protected trackById(_index: number, block: NewsletterComposerBlock): string {
    return block.id;
  }

  /** trackBy for palette entries. */
  protected trackByBlockType(_index: number, entry: NewsletterBlockManifestEntry): string {
    return entry.block_type;
  }

  /** Stable CDK drop-list id for a container block's nested list. */
  protected containerListId(blockId: string): string {
    return `newsletter-composer-container-${blockId}`;
  }

  /** Lists a container connects to: the canvas plus every other container. */
  protected containerConnectedTo(blockId: string): string[] {
    const ownId = this.containerListId(blockId);
    return [this.canvasListId, ...this.containerListIds().filter((id) => id !== ownId)];
  }

  // === Private Initializers ===

  /**
   * Render every canvas block to trusted preview HTML, keyed by local id.
   *
   * Trust note: the rendered string is injected via
   * `DomSanitizer.bypassSecurityTrustHtml`. The content is the AUTHENTICATED
   * author's OWN newsletter — the same trust boundary the repo already
   * documents for `body_html` / email chrome ("no sanitizer, trust boundary =
   * UI"). The declarative renderer further constrains output to an allowlisted,
   * inert HTML subset, so no scripts/handlers can ride along.
   */
  private initRenderedBlocks(): Signal<Map<string, SafeHtml>> {
    return computed(() => {
      const map = new Map<string, SafeHtml>();
      // The block currently being inline-edited: its HTML is FROZEN (reused from
      // the render cache) so a keystroke or a panel edit never re-renders under
      // the live caret. Edits are committed to content on blur, where a normal
      // re-render is safe (the caret is already gone).
      const frozenId = this.editingBlockId();
      // Touch the manifest so the computed re-runs once templates are loaded.
      if (!this.manifest()) return map;
      const templateOf = (blockType: string): string | undefined => this.manifestService.getBlock(blockType)?.template;

      const renderInto = (block: NewsletterComposerBlock, html: () => string): void => {
        const frozen = block.id === frozenId ? this.renderCache.get(block.id) : undefined;
        const safe = frozen ?? this.sanitizer.bypassSecurityTrustHtml(html());
        this.renderCache.set(block.id, safe);
        map.set(block.id, safe);
      };

      for (const block of this.blocks()) {
        // Container blocks render their chrome WITHOUT slot content — the live
        // child drop-list in the template hosts the (independently rendered)
        // children, so the slot is left empty to avoid double-rendering.
        const children = block.isContainer ? [] : this.toLayoutChildren(block);
        renderInto(block, () => this.renderer.renderBlock(templateOf(block.block_type), block.content, children, templateOf, true));
        for (const child of block.children ?? []) {
          renderInto(child, () => this.renderer.renderBlock(templateOf(child.block_type), child.content, [], templateOf, true));
        }
      }
      // Drop cache entries for blocks no longer on the canvas.
      for (const id of Array.from(this.renderCache.keys())) {
        if (!map.has(id)) this.renderCache.delete(id);
      }
      return map;
    });
  }

  /**
   * After each render, make the SELECTED block's `data-nl-field` elements
   * contentEditable and (re)position the floating toolbar. Reading
   * `renderedBlocks()` + `selectedBlockId()` makes the effect re-run when the
   * canvas re-renders or the selection moves. Browser-only — the marker
   * elements only exist after the canvas hydrates client-side.
   *
   * Idempotency: elements already wired carry a `data-nl-wired` flag, so a
   * re-run doesn't double-bind. Listeners are added with `{ once: false }`
   * straight on the element; Angular discards and recreates the element on the
   * NEXT (non-frozen) re-render, which drops the old listeners with it.
   */
  private initInlineEditingEffect(): void {
    afterRenderEffect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      // Tracked deps: re-run on canvas re-render and on selection change. The
      // toolbar / editing-block reads + writes below are `untracked` so writing
      // the toolbar signal here can't feed back into this effect.
      this.renderedBlocks();
      const selectedId = this.selectedBlockId();

      untracked(() => {
        const canvas = this.canvasRef()?.nativeElement;
        if (!canvas) return;

        // Only the selected block's rendered region is made editable (matches
        // Gatewaze, where inline editing is gated to the selected component).
        const host = selectedId ? canvas.querySelector<HTMLElement>(`[data-nl-block="${cssEscape(selectedId)}"]`) : null;
        if (host) {
          const fields = host.querySelectorAll<HTMLElement>('[data-nl-field]:not([data-nl-wired])');
          fields.forEach((el) => this.wireEditable(el, selectedId!));
        }

        // Keep the toolbar pinned to the selected block (unless mid-edit, where
        // the blur commit re-renders and repositions anyway).
        if (!this.editingBlockId()) this.repositionToolbar();
      });
    });
  }

  /**
   * The full assembled email HTML (wrapper chrome + every block), rendered the
   * same way a send does (`editMode` off). Recomputes when the canvas blocks or
   * the manifest change. Browser-only (the renderer no-ops on the server).
   */
  private initFullHtml(): Signal<string> {
    return computed(() => {
      const manifest = this.manifest();
      if (!manifest) return '';
      const templateOf = (blockType: string): string | undefined => this.manifestService.getBlock(blockType)?.template;
      return this.renderer.renderNewsletter(manifest.wrapper, this.toLayout().blocks, templateOf, this.wrapperPreviewContent(), false);
    });
  }

  private initWrapperHeader(): Signal<SafeHtml> {
    return computed(() => {
      const wrapper = this.manifest()?.wrapper;
      const { header } = this.renderer.renderWrapperChrome(wrapper, this.wrapperPreviewContent());
      return this.sanitizer.bypassSecurityTrustHtml(header);
    });
  }

  private initWrapperFooter(): Signal<SafeHtml> {
    return computed(() => {
      const wrapper = this.manifest()?.wrapper;
      const { footer } = this.renderer.renderWrapperChrome(wrapper, this.wrapperPreviewContent());
      return this.sanitizer.bypassSecurityTrustHtml(footer);
    });
  }

  private initContainerListIds(): Signal<string[]> {
    return computed(() =>
      this.blocks()
        .filter((block) => block.isContainer)
        .map((block) => this.containerListId(block.id))
    );
  }

  /**
   * The libraries offered by the picker: the loaded catalog, or a single
   * synthesized entry for the active key (label humanized from the key) when the
   * catalog is empty — so the picker always shows the current library even
   * before the catalog endpoint responds (or when it isn't available).
   */
  private initAvailableTemplates(): Signal<NewsletterTemplateInfo[]> {
    return computed(() => {
      const catalog = this.manifestService.templates();
      if (catalog.length) return catalog;
      const key = this.selectedTemplateKey();
      return [{ key, label: humanizeFieldKey(key) }];
    });
  }

  private initPaletteGroups(): Signal<NewsletterBlockPaletteGroup[]> {
    return computed(() => {
      const manifest = this.manifest();
      if (!manifest) return [];
      const groups = new Map<string, NewsletterBlockManifestEntry[]>();
      for (const entry of manifest.blocks) {
        const category = entry.category ?? 'block';
        const bucket = groups.get(category) ?? [];
        bucket.push(entry);
        groups.set(category, bucket);
      }
      return Array.from(groups.entries()).map(([category, entries]) => ({ category, entries }));
    });
  }

  /**
   * The palette groups actually rendered: the category groups when the search
   * box is empty, or a single flat "Results" group of blocks whose label or
   * block type contains the query (case-insensitive) while searching.
   */
  private initDisplayGroups(): Signal<NewsletterBlockPaletteGroup[]> {
    return computed(() => {
      const query = this.blockSearch().trim().toLowerCase();
      const groups = this.paletteGroups();
      if (!query) return groups;
      const matches = groups
        .flatMap((group) => group.entries)
        .filter((entry) => entry.label.toLowerCase().includes(query) || entry.block_type.toLowerCase().includes(query));
      return matches.length ? [{ category: 'Results', entries: matches }] : [];
    });
  }

  // === Private Helpers ===

  /** Returns the manifest entry when the drop originated from the palette list. */
  private asPaletteEntry(event: CdkDragDrop<NewsletterComposerBlock[]>): NewsletterBlockManifestEntry | null {
    if (event.previousContainer.id !== this.paletteListId) return null;
    return (event.item.data as NewsletterBlockManifestEntry | undefined) ?? null;
  }

  /**
   * Remove the dragged block from its source list (canvas or a container) and
   * return it, so the drop handler can re-insert it into the target list. No-op
   * for palette drops (the caller handles those before reaching here).
   */
  private detachFromSource(event: CdkDragDrop<NewsletterComposerBlock[]>): NewsletterComposerBlock | null {
    const sourceId = event.previousContainer.id;

    if (sourceId === this.canvasListId) {
      const next = [...this.blocks()];
      const [removed] = next.splice(event.previousIndex, 1);
      this.blocks.set(next);
      return removed ?? null;
    }

    // Source is a container list — find the owning parent by its list id.
    const parent = this.blocks().find((block) => block.isContainer && this.containerListId(block.id) === sourceId);
    if (!parent) return null;
    const children = [...(parent.children ?? [])];
    const [removed] = children.splice(event.previousIndex, 1);
    this.updateBlock(parent.id, { children });
    return removed ?? null;
  }

  /**
   * Build a fresh canvas block from a manifest entry, seeding scalar fields from
   * their schema `default` so the block renders something immediately (e.g. the
   * logo_header banner shows its default image without opening Fields first).
   */
  private create(entry: NewsletterBlockManifestEntry): NewsletterComposerBlock {
    return {
      id: `block-${this.blockIdCounter++}`,
      block_type: entry.block_type,
      label: entry.label,
      isContainer: !!entry.is_container,
      content: this.seedDefaults(entry.schema),
      children: entry.is_container ? [] : undefined,
    };
  }

  /** Initial content seeded from a schema's scalar `default` values. */
  private seedDefaults(schema: NewsletterFieldSchema | undefined): Record<string, unknown> {
    const content: Record<string, unknown> = {};
    if (!schema) return content;
    for (const [key, def] of Object.entries(schema)) {
      if (def.type === 'slot' || def.type === 'array') continue;
      if (def.default !== undefined) content[key] = def.default;
    }
    return content;
  }

  /** Normalise a stored spacing value to a CSS string, defaulting to `0px`. */
  private spacingValue(raw: unknown): string {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : NEWSLETTER_SPACING_DEFAULT;
  }

  /** Build the per-block outer-spacing style map (top-level + container children). */
  private initBlockSpacingStyles(): Signal<Map<string, Record<string, string>>> {
    return computed(() => {
      const map = new Map<string, Record<string, string>>();
      for (const block of this.blocks()) {
        map.set(block.id, this.spacingStyleFor(block));
        for (const child of block.children ?? []) {
          map.set(child.id, this.spacingStyleFor(child));
        }
      }
      return map;
    });
  }

  /**
   * The outer-spacing inline style for a block, from its reserved
   * `_spacing_padding` / `_spacing_margin` content keys. Empty when both are
   * default — matching gatewaze, which skips the spacing wrapper at `0px`.
   */
  private spacingStyleFor(block: NewsletterComposerBlock): Record<string, string> {
    const padding = this.spacingValue(block.content[NEWSLETTER_SPACING_PADDING_KEY]);
    const margin = this.spacingValue(block.content[NEWSLETTER_SPACING_MARGIN_KEY]);
    const style: Record<string, string> = {};
    if (padding !== NEWSLETTER_SPACING_DEFAULT) style['padding'] = padding;
    if (margin !== NEWSLETTER_SPACING_DEFAULT) style['margin'] = margin;
    return style;
  }

  /** Rehydrate a persisted layout block (and its children) into a canvas block. */
  private hydrate(block: { block_type: string; content?: Record<string, unknown>; blocks?: unknown[] }): NewsletterComposerBlock {
    const entry = this.manifestService.getBlock(block.block_type);
    const childLayout = Array.isArray(block.blocks) ? (block.blocks as { block_type: string; content?: Record<string, unknown>; blocks?: unknown[] }[]) : [];
    // Container-ness is derived from the persisted layout (a `blocks` array)
    // as well as the manifest. `hydrate` runs synchronously in ngOnInit, which
    // can be BEFORE the manifest resolves on a fresh mount — relying on the
    // manifest alone would treat a reopened container as a leaf and silently
    // drop its nested children on the next save.
    const isContainer = !!entry?.is_container || Array.isArray(block.blocks);
    return {
      id: `block-${this.blockIdCounter++}`,
      block_type: block.block_type,
      label: entry?.label ?? humanizeFieldKey(block.block_type),
      isContainer,
      content: block.content ?? {},
      children: isContainer ? childLayout.map((child) => this.hydrate(child)) : undefined,
    };
  }

  /** Patch a top-level block immutably. */
  private updateBlock(id: string, patch: Partial<NewsletterComposerBlock>): void {
    this.blocks.update((current) => current.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  /** Find a block by id within a tree (top-level or container child). */
  private findBlock(blocks: NewsletterComposerBlock[], id: string): NewsletterComposerBlock | null {
    for (const block of blocks) {
      if (block.id === id) return block;
      const child = block.children?.find((c) => c.id === id);
      if (child) return child;
    }
    return null;
  }

  /** Immutably replace the `content` of the block matching `id` (top-level or child). */
  private patchContent(blocks: NewsletterComposerBlock[], id: string, content: Record<string, unknown>): NewsletterComposerBlock[] {
    return blocks.map((block) => {
      if (block.id === id) {
        return { ...block, content };
      }
      if (block.children?.some((child) => child.id === id)) {
        return {
          ...block,
          children: block.children.map((child) => (child.id === id ? { ...child, content } : child)),
        };
      }
      return block;
    });
  }

  /** All ids in a sub-tree (a block plus its children). */
  private collectIds(blocks: NewsletterComposerBlock[]): string[] {
    const ids: string[] = [];
    for (const block of blocks) {
      ids.push(block.id);
      if (block.children) ids.push(...block.children.map((child) => child.id));
    }
    return ids;
  }

  /** Drop the current selection if its block was just removed. */
  private clearSelectionIfRemoved(removedIds: string[]): void {
    const selected = this.selectedBlockId();
    if (selected && removedIds.includes(selected)) {
      this.selectedBlockId.set(null);
    }
  }

  // === Inline-editing helpers ===

  /**
   * Wire one `data-nl-field` element for inline editing: mark it editable,
   * select-on-focus, freeze-while-typing, and commit-on-blur.
   */
  private wireEditable(el: HTMLElement, blockId: string): void {
    el.setAttribute('data-nl-wired', 'true');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-testid', `newsletter-composer-inline-${el.getAttribute('data-nl-field')}`);
    // Suppress the native browser spellcheck squiggle noise inside the preview.
    el.spellcheck = false;

    el.addEventListener('focus', () => {
      const richtext = el.getAttribute('data-nl-richtext') === 'true';
      // Selecting the block keeps panel + canvas consistent; freezing its HTML
      // is what protects the caret from re-renders while typing.
      if (this.selectedBlockId() !== blockId) this.selectBlock(blockId);
      this.editingBlockId.set(blockId);
      // Show the richtext formatting controls only for richtext fields.
      this.toolbar.update((t) => (t ? { ...t, richtextActive: richtext } : t));
    });

    // Commit on every keystroke so the Fields panel (and any other consumer of
    // block.content) mirrors the inline edit LIVE — matching the panel→canvas
    // direction, which already updates instantly. Safe under the caret: the
    // block is frozen (`editingBlockId` set), so its re-render reuses the cached
    // HTML while the separate sidebar form patches its controls in place.
    el.addEventListener('input', () => this.commitInlineEdit(el, blockId));

    el.addEventListener('blur', () => {
      this.commitInlineEdit(el, blockId);
      this.editingBlockId.set(null);
      this.toolbar.update((t) => (t ? { ...t, richtextActive: false } : t));
    });
  }

  /**
   * Read the edited element back into `block.content[field]` and re-emit. Text
   * fields round-trip via `textContent`; richtext fields via `innerHTML`. No-op
   * when the value is unchanged, so a focus-with-no-edit doesn't churn the
   * layout. Called live on every `input` (the block is frozen, so the re-render
   * reuses cached HTML and the caret is untouched) and once more on blur.
   */
  private commitInlineEdit(el: HTMLElement, blockId: string): void {
    const field = el.getAttribute('data-nl-field');
    if (!field) return;
    const richtext = el.getAttribute('data-nl-richtext') === 'true';
    const next = richtext ? el.innerHTML : (el.textContent ?? '');

    const block = this.findBlock(this.blocks(), blockId);
    if (!block) return;
    // `field` may be a dotted/indexed path into an `each` item (e.g.
    // `jobs.0.company`); write into the nested array/object rather than a flat key.
    if (getAtPath(block.content, field) === next) return;

    const content = setAtPath(block.content, field, next);
    this.blocks.update((current) => this.patchContent(current, blockId, content));
    this.emit();
  }

  /** Deep-clone a canvas block sub-tree with fresh ids (for Duplicate). */
  private cloneBlock(block: NewsletterComposerBlock): NewsletterComposerBlock {
    return {
      ...block,
      id: `block-${this.blockIdCounter++}`,
      content: structuredClone(block.content),
      children: block.children?.map((child) => this.cloneBlock(child)),
    };
  }

  // === Floating-toolbar positioning ===

  /** Reposition the toolbar after the next frame (post-layout). */
  private scheduleToolbarReposition(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    requestAnimationFrame(() => this.repositionToolbar());
  }

  /**
   * Position the floating toolbar over the selected block. Coordinates are the
   * block host's offset relative to the canvas' positioned container (the
   * toolbar is absolutely positioned inside it), so it tracks the block on
   * scroll/resize of the page without per-pixel listeners. Clears the toolbar
   * when nothing is selected or the host isn't in the DOM yet.
   */
  private repositionToolbar(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const id = this.selectedBlockId();
    const block = id ? this.findBlock(this.blocks(), id) : null;
    const canvas = this.canvasRef()?.nativeElement;
    if (!id || !block || !canvas) {
      this.toolbar.set(null);
      return;
    }
    const host = canvas.querySelector<HTMLElement>(`[data-nl-block="${cssEscape(id)}"]`);
    if (!host) {
      this.toolbar.set(null);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const top = Math.max(hostRect.top - canvasRect.top - TOOLBAR_OFFSET, 0);
    const left = Math.max(hostRect.left - canvasRect.left, 0);
    this.toolbar.set({
      blockId: id,
      label: block.label,
      top,
      left,
      isContainer: block.isContainer,
      richtextActive: this.toolbar()?.richtextActive ?? false,
    });
  }

  /** Project the canvas into a NewsletterLayout and emit it. */
  private emit(): void {
    this.layoutChange.emit(this.toLayout());
  }

  /** A container block's children projected to the shared NewsletterBlock shape. */
  private toLayoutChildren(block: NewsletterComposerBlock): NewsletterBlock[] {
    if (!block.isContainer || !block.children) return [];
    return block.children.map((child) => this.toLayoutBlock(child));
  }

  /**
   * Placeholder runtime fields for the wrapper preview (date / view-online /
   * unsubscribe links). These are substituted per recipient at send time; the
   * editor shows representative values so the chrome reads like the real email.
   */
  private wrapperPreviewContent(): Record<string, unknown> {
    return {
      edition: {
        date: 'Newsletter preview',
        view_online_link: '',
        unsubscribe_url: '#',
        manage_subscriptions_url: '#',
      },
    };
  }

  /**
   * Map the canvas blocks back to the shared NewsletterLayout shape.
   *
   * `template_key` records the selected block library so the newsletter renders
   * from it server-side and reopens into the same library. The newsletter-service
   * accepts and renders from this key (LFXV2-2747); an empty/omitted key renders
   * from the default library.
   */
  private toLayout(): NewsletterLayout {
    return {
      wrapper_key: this.manifest()?.wrapper_key ?? 'default',
      template_key: this.selectedTemplateKey(),
      blocks: this.blocks().map((block) => this.toLayoutBlock(block)),
    };
  }

  private toLayoutBlock(block: NewsletterComposerBlock): NewsletterLayout['blocks'][number] {
    const layoutBlock: NewsletterLayout['blocks'][number] = {
      block_type: block.block_type,
      content: block.content,
    };
    if (block.isContainer && block.children) {
      layoutBlock.blocks = block.children.map((child) => this.toLayoutBlock(child));
    }
    return layoutBlock;
  }
}

/** Vertical gap (px) between the floating toolbar and the top of its block. */
const TOOLBAR_OFFSET = 32;

/**
 * Gmail clips a message once its HTML exceeds ~102 KB (hiding everything past
 * the cut behind a "[Message clipped] View entire message" link). We warn as
 * the rendered email approaches that ceiling. Matches Gatewaze's thresholds.
 */
const GMAIL_WARN_BYTES = 90 * 1024;
const GMAIL_CLIP_BYTES = 102 * 1024;

/**
 * Read a dotted/indexed path out of a content object (`jobs.0.company`). A bare
 * key (`title`) reads the top level. Returns undefined for a missing path.
 */
function getAtPath(content: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, content);
}

/** Path segments that must never be written through (prototype-pollution guard). */
const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Immutably write `value` at a dotted/indexed path, cloning each container along
 * the way (objects spread, arrays copied) so the original content tree is never
 * mutated. Numeric segments index into arrays (`jobs.0.company`) — a missing
 * container is created as an array when the next segment is numeric, else an
 * object; a bare key (`title`) sets the top level, matching the previous
 * flat-key behaviour. A path touching a reserved key (`__proto__` etc.) is
 * rejected (returns `content` unchanged) so a crafted field key can't pollute
 * the prototype.
 */
function setAtPath(content: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('.');
  if (segments.some((seg) => RESERVED_PATH_SEGMENTS.has(seg))) {
    return content;
  }
  const root: Record<string, unknown> | unknown[] = Array.isArray(content) ? [...content] : { ...content };
  let cursor: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const child = (cursor as Record<string, unknown>)[seg];
    let clone: Record<string, unknown> | unknown[];
    if (Array.isArray(child)) {
      clone = [...child];
    } else if (child && typeof child === 'object') {
      clone = { ...(child as Record<string, unknown>) };
    } else {
      // Missing container — shape it to match the next segment (array for an
      // index, object otherwise) so the written tree stays well-formed.
      clone = /^\d+$/.test(segments[i + 1]) ? [] : {};
    }
    (cursor as Record<string, unknown>)[seg] = clone;
    cursor = clone;
  }
  (cursor as Record<string, unknown>)[segments[segments.length - 1]] = value;
  return root as Record<string, unknown>;
}

/**
 * Escape a string for use inside a CSS attribute-selector value. Uses
 * `CSS.escape` when available (every modern browser); falls back to escaping
 * the characters our ids could contain. Browser-only callers.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, '\\$&');
}
