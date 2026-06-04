// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { Editor } from '@tiptap/core';
import { RichEditorToolbarButton } from '@lfx-one/shared/interfaces';

import { cleanPastedHtml } from './clean-pasted-html.util';

const TOOLBAR_BUTTONS: readonly RichEditorToolbarButton[] = [
  { id: 'h2', icon: 'fa-light fa-h2', label: 'Heading 2', command: 'h2', activeKey: 'heading', activeAttrs: { level: 2 } },
  { id: 'h3', icon: 'fa-light fa-h3', label: 'Heading 3', command: 'h3', activeKey: 'heading', activeAttrs: { level: 3 } },
  { id: 'bold', icon: 'fa-light fa-bold', label: 'Bold', command: 'bold', activeKey: 'bold' },
  { id: 'italic', icon: 'fa-light fa-italic', label: 'Italic', command: 'italic', activeKey: 'italic' },
  { id: 'underline', icon: 'fa-light fa-underline', label: 'Underline', command: 'underline', activeKey: 'underline' },
  { id: 'strike', icon: 'fa-light fa-strikethrough', label: 'Strikethrough', command: 'strike', activeKey: 'strike' },
  { id: 'bulletList', icon: 'fa-light fa-list-ul', label: 'Bullet list', command: 'bulletList', activeKey: 'bulletList' },
  { id: 'orderedList', icon: 'fa-light fa-list-ol', label: 'Numbered list', command: 'orderedList', activeKey: 'orderedList' },
  { id: 'link', icon: 'fa-light fa-link', label: 'Link', command: 'link', activeKey: 'link' },
  { id: 'clear', icon: 'fa-light fa-eraser', label: 'Clear formatting', command: 'clear' },
];

const TOOLBAR_DIVIDERS = new Set(['underline', 'strike', 'orderedList']);

@Component({
  selector: 'lfx-rich-editor',
  imports: [ReactiveFormsModule],
  templateUrl: './rich-editor.component.html',
  styleUrl: './rich-editor.component.scss',
})
export class RichEditorComponent {
  // 1. Private injections
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  // 2. Inputs
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly placeholder = input<string>('');
  public readonly editorStyle = input<Record<string, string>>({ minHeight: '320px' });
  public readonly readonly = input<boolean>(false);
  public readonly dataTest = input<string>();

  // viewChild for the editor mount point
  protected readonly editorHost = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');

  // 5. WritableSignals
  protected readonly editorReady = signal(false);
  protected readonly activeStates = signal<Record<string, boolean>>({});
  protected readonly buttons = TOOLBAR_BUTTONS;

  // Editor instance (browser-only, untracked by signals)
  private editor: Editor | null = null;
  private suppressUpdate = false;

  // 7. Constructor
  public constructor() {
    afterNextRender(() => {
      void this.initEditor();
    });
    this.destroyRef.onDestroy(() => {
      this.editor?.destroy();
      this.editor = null;
    });
  }

  // 9. Protected methods (called from template)
  protected runCommand(button: RichEditorToolbarButton): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    const chain = editor.chain().focus();
    switch (button.command) {
      case 'h2':
        chain.toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        chain.toggleHeading({ level: 3 }).run();
        break;
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'underline':
        chain.toggleUnderline().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'bulletList':
        chain.toggleBulletList().run();
        break;
      case 'orderedList':
        chain.toggleOrderedList().run();
        break;
      case 'link':
        this.toggleLink(editor);
        break;
      case 'clear':
        chain.unsetAllMarks().clearNodes().run();
        break;
    }
  }

  protected isActive(button: RichEditorToolbarButton): boolean {
    if (!button.activeKey) {
      return false;
    }
    return this.activeStates()[button.id] ?? false;
  }

  protected hasDivider(button: RichEditorToolbarButton): boolean {
    return TOOLBAR_DIVIDERS.has(button.id);
  }

  // 10. Private initializer
  private async initEditor(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const [{ Editor: TiptapEditor }, starterKitModule, underlineModule, linkModule, placeholderModule] = await Promise.all([
      import('@tiptap/core'),
      import('@tiptap/starter-kit'),
      import('@tiptap/extension-underline'),
      import('@tiptap/extension-link'),
      import('@tiptap/extension-placeholder'),
    ]);

    const StarterKit = starterKitModule.default ?? starterKitModule;
    const Underline = underlineModule.default ?? underlineModule;
    const Link = linkModule.default ?? linkModule;
    const Placeholder = placeholderModule.default ?? placeholderModule;

    const ctrl = this.getControl();
    const initialValue = typeof ctrl?.value === 'string' ? ctrl.value : '';

    this.editor = new TiptapEditor({
      element: this.editorHost().nativeElement,
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        }),
        Placeholder.configure({ placeholder: this.placeholder() }),
      ],
      content: initialValue,
      editable: !this.readonly(),
      editorProps: {
        attributes: {
          class: 'lfx-rich-editor__content prose prose-sm max-w-none focus:outline-none',
          'data-testid': this.dataTest() ?? '',
        },
        transformPastedHTML: (html: string) => cleanPastedHtml(html),
      },
      onUpdate: ({ editor }) => {
        if (this.suppressUpdate) {
          return;
        }
        const html = editor.isEmpty ? '' : editor.getHTML();
        const control = this.getControl();
        if (!control) {
          return;
        }
        if (control.value !== html) {
          control.setValue(html);
          control.markAsDirty();
        }
        this.refreshActiveStates();
      },
      onSelectionUpdate: () => this.refreshActiveStates(),
      onBlur: () => this.getControl()?.markAsTouched(),
    });

    if (ctrl) {
      ctrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value: unknown) => {
        const next = typeof value === 'string' ? value : '';
        const editor = this.editor;
        if (!editor) {
          return;
        }
        const current = editor.isEmpty ? '' : editor.getHTML();
        if (current === next) {
          return;
        }
        this.suppressUpdate = true;
        editor.commands.setContent(next || '', false);
        this.suppressUpdate = false;
        this.refreshActiveStates();
      });
    }

    this.editorReady.set(true);
    this.refreshActiveStates();
  }

  private toggleLink(editor: Editor): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const previous = editor.getAttributes('link')['href'];
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url === null) {
      return;
    }
    const trimmed = url.trim();
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) {
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  }

  private refreshActiveStates(): void {
    const editor = this.editor;
    if (!editor) {
      return;
    }
    const next: Record<string, boolean> = {};
    for (const button of TOOLBAR_BUTTONS) {
      if (!button.activeKey) {
        continue;
      }
      next[button.id] = button.activeAttrs ? editor.isActive(button.activeKey, button.activeAttrs) : editor.isActive(button.activeKey);
    }
    this.activeStates.set(next);
  }

  private getControl(): AbstractControl | null {
    return this.form().get(this.control());
  }
}
