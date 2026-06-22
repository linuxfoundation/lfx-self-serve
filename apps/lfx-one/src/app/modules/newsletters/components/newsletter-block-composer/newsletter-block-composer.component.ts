// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, OnInit, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import { NEWSLETTER_SPACING_DEFAULT, NEWSLETTER_SPACING_MARGIN_KEY, NEWSLETTER_SPACING_PADDING_KEY } from '@lfx-one/shared/constants';
import {
  NewsletterBlock,
  NewsletterBlockManifestEntry,
  NewsletterBlockPaletteGroup,
  NewsletterComposerBlock,
  NewsletterComposerTab,
  NewsletterComposerTabDef,
  NewsletterFieldSchema,
  NewsletterLayout,
  NewsletterOutlineEntry,
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
 */
@Component({
  selector: 'lfx-newsletter-block-composer',
  imports: [DragDropModule, ButtonComponent, NewsletterBlockFieldsComponent],
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

  // === Outputs ===
  // Emits the current layout whenever the canvas changes.
  public readonly layoutChange = output<NewsletterLayout>();

  // === Writable Signals ===
  protected readonly isBrowser = signal<boolean>(false);
  // The canvas: the ordered top-level blocks the user has composed.
  protected readonly blocks = signal<NewsletterComposerBlock[]>([]);
  // The currently selected block (top-level or container child), edited in the
  // fields panel. Null when nothing is selected.
  protected readonly selectedBlockId = signal<string | null>(null);
  // The active left-rail tab (Gatewaze-Puck parity). Selecting a block
  // auto-switches this to 'fields'; the user can switch back to 'blocks'.
  protected readonly activeTab = signal<NewsletterComposerTab>('blocks');

  // === Derived Signals (from the manifest service) ===
  protected readonly manifest = this.manifestService.manifest;
  protected readonly manifestLoading = this.manifestService.loading;
  protected readonly manifestError = this.manifestService.error;

  // === Computed Signals ===
  // Manifest blocks grouped by category for the palette rendering.
  protected readonly paletteGroups: Signal<NewsletterBlockPaletteGroup[]> = this.initPaletteGroups();
  protected readonly hasBlocks: Signal<boolean> = computed(() => this.blocks().length > 0);
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

  // Flattened canvas outline (top-level + container children) for the Outline tab.
  protected readonly outline: Signal<NewsletterOutlineEntry[]> = computed(() => {
    const entries: NewsletterOutlineEntry[] = [];
    for (const block of this.blocks()) {
      entries.push({ id: block.id, label: block.label, blockType: block.block_type, depth: 0, isContainer: block.isContainer });
      for (const child of block.children ?? []) {
        entries.push({ id: child.id, label: child.label, blockType: child.block_type, depth: 1, isContainer: child.isContainer });
      }
    }
    return entries;
  });

  // The breadcrumb label for the Fields tab header ("Page › <Block label>").
  protected readonly fieldsBreadcrumb: Signal<string> = computed(() => this.selectedBlock()?.label ?? '');

  // The left-rail tab definitions (icons + labels; AI is a disabled placeholder).
  protected readonly tabs: NewsletterComposerTabDef[] = [
    { id: 'blocks', label: 'Blocks', icon: 'fa-light fa-cube' },
    { id: 'fields', label: 'Fields', icon: 'fa-light fa-sliders' },
    { id: 'outline', label: 'Outline', icon: 'fa-light fa-list-tree' },
    { id: 'ai', label: 'AI', icon: 'fa-light fa-sparkles', disabled: true },
  ];

  // The wrapper chrome (header above / footer below the blocks), rendered from
  // the manifest's wrapper template. Recomputes when the manifest loads.
  protected readonly wrapperHeader: Signal<SafeHtml> = this.initWrapperHeader();
  protected readonly wrapperFooter: Signal<SafeHtml> = this.initWrapperFooter();

  // Per-block rendered (and trusted) preview HTML, keyed by the block's local
  // id. Recomputes whenever the canvas blocks or the manifest change — i.e. a
  // Fields-panel edit (which patches block.content) re-renders that block.
  protected readonly renderedBlocks: Signal<Map<string, SafeHtml>> = this.initRenderedBlocks();

  // Stable drop-list ids.
  protected readonly canvasListId = 'newsletter-composer-canvas-list';
  protected readonly paletteListId = 'newsletter-composer-palette-list';

  // Monotonic counter for unique per-instance block ids (CDK trackBy + child lists).
  private blockIdCounter = 0;

  public ngOnInit(): void {
    this.isBrowser.set(isPlatformBrowser(this.platformId));

    const seed = this.initialLayout();
    if (seed?.blocks?.length) {
      this.blocks.set(seed.blocks.map((block) => this.hydrate(block)));
    }

    // Browser-only: fetch the palette manifest.
    if (isPlatformBrowser(this.platformId)) {
      this.manifestService.ensureLoaded().subscribe();
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
   * Select a block (top-level or container child) for field editing and
   * auto-switch the rail to the Fields tab — replicates Puck's
   * `setUi → plugin:'fields'` on select.
   */
  protected selectBlock(id: string): void {
    this.selectedBlockId.set(id);
    this.activeTab.set('fields');
  }

  /** Switch the active left-rail tab. Selection persists across tab changes. */
  protected setTab(tab: NewsletterComposerTab): void {
    if (this.tabs.find((t) => t.id === tab)?.disabled) return;
    this.activeTab.set(tab);
  }

  /** True when the given rail tab is the active one. */
  protected isActiveTab(tab: NewsletterComposerTab): boolean {
    return this.activeTab() === tab;
  }

  /**
   * The outer-spacing inline style for a canvas block, from its reserved
   * `_spacing_padding` / `_spacing_margin` content keys. Empty when both are
   * default — matching gatewaze, which skips the spacing wrapper at `0px`.
   */
  protected blockSpacingStyle(block: NewsletterComposerBlock): Record<string, string> {
    const padding = this.spacingValue(block.content[NEWSLETTER_SPACING_PADDING_KEY]);
    const margin = this.spacingValue(block.content[NEWSLETTER_SPACING_MARGIN_KEY]);
    const style: Record<string, string> = {};
    if (padding !== NEWSLETTER_SPACING_DEFAULT) style['padding'] = padding;
    if (margin !== NEWSLETTER_SPACING_DEFAULT) style['margin'] = margin;
    return style;
  }

  /** Trusted, rendered preview HTML for a block id (empty when not yet rendered). */
  protected renderedBlock(id: string): SafeHtml {
    return this.renderedBlocks().get(id) ?? '';
  }

  /** True when the given block id is the selected one (for highlighting). */
  protected isSelected(id: string): boolean {
    return this.selectedBlockId() === id;
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
      // Touch the manifest so the computed re-runs once templates are loaded.
      if (!this.manifest()) return map;
      const templateOf = (blockType: string): string | undefined => this.manifestService.getBlock(blockType)?.template;
      for (const block of this.blocks()) {
        // Container blocks render their chrome WITHOUT slot content — the live
        // child drop-list in the template hosts the (independently rendered)
        // children, so the slot is left empty to avoid double-rendering.
        const children = block.isContainer ? [] : this.toLayoutChildren(block);
        const html = this.renderer.renderBlock(templateOf(block.block_type), block.content, children, templateOf);
        map.set(block.id, this.sanitizer.bypassSecurityTrustHtml(html));
        for (const child of block.children ?? []) {
          const childHtml = this.renderer.renderBlock(templateOf(child.block_type), child.content, [], templateOf);
          map.set(child.id, this.sanitizer.bypassSecurityTrustHtml(childHtml));
        }
      }
      return map;
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

  /** Rehydrate a persisted layout block (and its children) into a canvas block. */
  private hydrate(block: { block_type: string; content?: Record<string, unknown>; blocks?: unknown[] }): NewsletterComposerBlock {
    const entry = this.manifestService.getBlock(block.block_type);
    const isContainer = !!entry?.is_container;
    const childLayout = Array.isArray(block.blocks) ? (block.blocks as { block_type: string; content?: Record<string, unknown>; blocks?: unknown[] }[]) : [];
    return {
      id: `block-${this.blockIdCounter++}`,
      block_type: block.block_type,
      label: entry?.label ?? block.block_type,
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

  /** Map the canvas blocks back to the shared NewsletterLayout shape. */
  private toLayout(): NewsletterLayout {
    return {
      wrapper_key: this.manifest()?.wrapper_key ?? 'default',
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
