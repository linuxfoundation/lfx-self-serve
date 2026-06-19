// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, OnInit, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { NewsletterBlockManifestEntry, NewsletterBlockPaletteGroup, NewsletterComposerBlock, NewsletterLayout } from '@lfx-one/shared/interfaces';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';

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
  imports: [DragDropModule, ButtonComponent],
  templateUrl: './newsletter-block-composer.component.html',
  styleUrl: './newsletter-block-composer.component.scss',
})
export class NewsletterBlockComposerComponent implements OnInit {
  // === Services ===
  private readonly manifestService = inject(NewsletterManifestService);
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

  /** Append a palette block to the end of the canvas. */
  protected addBlock(entry: NewsletterBlockManifestEntry): void {
    this.blocks.update((current) => [...current, this.create(entry)]);
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
    this.blocks.update((current) => current.filter((block) => block.id !== id));
    this.emit();
  }

  /** Remove a child block from a container block. */
  protected removeChild(parentId: string, childId: string): void {
    const parent = this.blocks().find((block) => block.id === parentId);
    if (!parent) return;
    const children = (parent.children ?? []).filter((child) => child.id !== childId);
    this.updateBlock(parentId, { children });
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

  /** Build a fresh canvas block from a manifest entry (empty Phase-1 content). */
  private create(entry: NewsletterBlockManifestEntry): NewsletterComposerBlock {
    return {
      id: `block-${this.blockIdCounter++}`,
      block_type: entry.block_type,
      label: entry.label,
      isContainer: !!entry.is_container,
      content: {},
      children: entry.is_container ? [] : undefined,
    };
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

  /** Project the canvas into a NewsletterLayout and emit it. */
  private emit(): void {
    this.layoutChange.emit(this.toLayout());
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
