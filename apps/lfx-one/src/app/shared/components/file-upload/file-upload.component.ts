// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef } from '@angular/core';
import { getAcceptedFileTypesDisplay } from '@lfx-one/shared/utils';
import { FileUploadModule } from 'primeng/fileupload';

@Component({
  selector: 'lfx-file-upload',
  imports: [DecimalPipe, NgTemplateOutlet, FileUploadModule],
  templateUrl: './file-upload.component.html',
  styleUrl: './file-upload.component.scss',
})
export class FileUploadComponent {
  // Template references for content projection (follow PrimeNG slot names)
  @ContentChild('header', { static: false, descendants: false }) public headerTemplate?: TemplateRef<any>;
  @ContentChild('file', { static: false, descendants: false }) public fileTemplate?: TemplateRef<any>;
  @ContentChild('content', { static: false, descendants: false }) public contentTemplate?: TemplateRef<any>;
  @ContentChild('toolbar', { static: false, descendants: false }) public toolbarTemplate?: TemplateRef<any>;
  @ContentChild('chooseicon', { static: false, descendants: false }) public chooseIconTemplate?: TemplateRef<any>;
  @ContentChild('filelabel', { static: false, descendants: false }) public fileLabelTemplate?: TemplateRef<any>;
  @ContentChild('uploadicon', { static: false, descendants: false }) public uploadIconTemplate?: TemplateRef<any>;
  @ContentChild('cancelicon', { static: false, descendants: false }) public cancelIconTemplate?: TemplateRef<any>;
  @ContentChild('empty', { static: false, descendants: false }) public emptyTemplate?: TemplateRef<any>;

  // Core behavior
  public readonly mode = input<'advanced' | 'basic'>('advanced');
  public readonly name = input<string>('file');
  public readonly url = input<string | undefined>(undefined);
  public readonly method = input<'post' | 'put'>('post');
  public readonly multiple = input<boolean>(false);
  public readonly accept = input<string | undefined>(undefined);
  public readonly maxFileSize = input<number | undefined>(undefined);
  public readonly auto = input<boolean>(false);
  public readonly customUpload = input<boolean>(false);
  public readonly disabled = input<boolean>(false);
  public readonly withCredentials = input<boolean>(false);
  public readonly previewWidth = input<number>(50);

  // Labels and icons
  public readonly chooseLabel = input<string | undefined>(undefined);
  public readonly uploadLabel = input<string | undefined>(undefined);
  public readonly cancelLabel = input<string | undefined>(undefined);
  public readonly showUploadButton = input<boolean>(true);
  public readonly showCancelButton = input<boolean>(true);
  public readonly showChooseIcon = input<boolean>(true);
  public readonly showUploadIcon = input<boolean>(true);
  public readonly showCancelIcon = input<boolean>(true);
  public readonly chooseIcon = input<string | undefined>(undefined);
  public readonly uploadIcon = input<string | undefined>(undefined);
  public readonly cancelIcon = input<string | undefined>(undefined);

  // Styling
  public readonly styleClass = input<string | undefined>(undefined);
  public readonly style = input<Record<string, any> | null | undefined>(undefined);
  public readonly dataTest = input<string | undefined>(undefined);
  public readonly uploadStyleClass = input<string | undefined>(undefined);
  public readonly chooseStyleClass = input<string | undefined>(undefined);
  public readonly cancelStyleClass = input<string | undefined>(undefined);

  // Events
  public readonly onBeforeUpload = output<any>();
  public readonly onBeforeSend = output<any>();
  public readonly onUpload = output<any>();
  public readonly onError = output<any>();
  public readonly onClear = output<void>();
  public readonly onSelect = output<any>();
  public readonly onRemove = output<any>();
  public readonly onProgress = output<any>();
  public readonly onCustomUpload = output<any>();

  // Helper methods for template
  public getFileTypeHint(): string {
    const accept = this.accept();
    if (!accept) return '';

    // Check if accept string contains MIME types using regex pattern (type/subtype)
    // This matches any valid MIME type format like image/*, application/pdf, audio/mp3, video/mp4, etc.
    const mimeTypePattern = /\w+\/[\w+\-.*]+/;
    if (mimeTypePattern.test(accept)) {
      // Use the presentable display function for our standard format
      return getAcceptedFileTypesDisplay();
    }

    // Fallback for custom accept strings (extension-only format)
    const extensions = accept.split(',').map((ext) => ext.trim().replace(/\./g, '').toUpperCase());
    return extensions.join(', ');
  }

  public getFileExtension(fileName: string): string {
    const extension = fileName.split('.').pop()?.toUpperCase();
    return extension || 'FILE';
  }

  // Handlers
  protected handleBeforeUpload(event: any): void {
    this.onBeforeUpload.emit(event);
  }

  protected handleBeforeSend(event: any): void {
    this.onBeforeSend.emit(event);
  }

  protected handleUpload(event: any): void {
    this.onUpload.emit(event);
  }

  protected handleError(event: any): void {
    this.onError.emit(event);
  }

  protected handleClear(): void {
    this.onClear.emit();
  }

  protected handleSelect(event: any): void {
    this.onSelect.emit(event);
  }

  protected handleRemove(event: any): void {
    this.onRemove.emit(event);
  }

  protected handleProgress(event: any): void {
    this.onProgress.emit(event);
  }

  protected handleCustomUpload(event: any): void {
    this.onCustomUpload.emit(event);
  }
}
