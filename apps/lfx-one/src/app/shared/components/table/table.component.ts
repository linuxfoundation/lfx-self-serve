// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef } from '@angular/core';
import { TableModule } from 'primeng/table';

@Component({
  selector: 'lfx-table',
  imports: [NgTemplateOutlet, TableModule],
  templateUrl: './table.component.html',
  styleUrls: ['./table.component.scss'],
})
export class TableComponent {
  // Template references for content projection
  @ContentChild('header', { static: false, descendants: false }) public headerTemplate?: TemplateRef<any>;
  @ContentChild('body', { static: false, descendants: false }) public bodyTemplate?: TemplateRef<any>;
  @ContentChild('footer', { static: false, descendants: false }) public footerTemplate?: TemplateRef<any>;
  @ContentChild('caption', { static: false, descendants: false }) public captionTemplate?: TemplateRef<any>;
  @ContentChild('summary', { static: false, descendants: false }) public summaryTemplate?: TemplateRef<any>;
  @ContentChild('emptymessage', { static: false, descendants: false }) public emptyMessageTemplate?: TemplateRef<any>;
  @ContentChild('loading', { static: false, descendants: false }) public loadingTemplate?: TemplateRef<any>;
  @ContentChild('loadingbody', { static: false, descendants: false }) public loadingBodyTemplate?: TemplateRef<any>;
  @ContentChild('groupheader', { static: false, descendants: false }) public groupHeaderTemplate?: TemplateRef<any>;
  @ContentChild('groupfooter', { static: false, descendants: false }) public groupFooterTemplate?: TemplateRef<any>;
  @ContentChild('paginatorleft', { static: false, descendants: false }) public paginatorLeftTemplate?: TemplateRef<any>;
  @ContentChild('paginatorright', { static: false, descendants: false }) public paginatorRightTemplate?: TemplateRef<any>;
  @ContentChild('paginatordropdownitem', { static: false, descendants: false }) public paginatorDropdownItemTemplate?: TemplateRef<any>;

  // Core data properties
  public readonly value = input<any[]>([]);
  public readonly columns = input<any[]>([]);
  public readonly dataKey = input<string>('');

  // Styling properties
  public readonly style = input<Record<string, any> | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);
  public readonly tableStyle = input<Record<string, any> | null | undefined>(undefined);
  public readonly tableStyleClass = input<string | undefined>(undefined);

  // Pagination properties
  public readonly paginator = input<boolean>(false);
  public readonly rows = input<number>(10);
  public readonly first = input<number>(0);
  public readonly totalRecords = input<number>(0);
  public readonly pageLinks = input<number>(5);
  public readonly rowsPerPageOptions = input<number[]>([]);
  public readonly alwaysShowPaginator = input<boolean>(true);
  public readonly paginatorPosition = input<'top' | 'bottom' | 'both'>('bottom');
  public readonly paginatorStyleClass = input<string | undefined>(undefined);
  public readonly paginatorDropdownAppendTo = input<any>(undefined);
  public readonly paginatorDropdownScrollHeight = input<string>('200px');
  public readonly currentPageReportTemplate = input<string>('{currentPage} of {totalPages}');
  public readonly showCurrentPageReport = input<boolean>(false);
  public readonly showJumpToPageDropdown = input<boolean>(false);
  public readonly showJumpToPageInput = input<boolean>(false);
  public readonly showFirstLastIcon = input<boolean>(true);
  public readonly showPageLinks = input<boolean>(true);

  // Sorting properties
  public readonly sortField = input<string | undefined>(undefined);
  public readonly sortOrder = input<number>(1);
  public readonly sortMode = input<'single' | 'multiple'>('single');
  public readonly defaultSortOrder = input<number>(1);
  public readonly multiSortMeta = input<any[]>([]);

  // Filtering properties
  public readonly globalFilterFields = input<string[]>([]);
  public readonly filterDelay = input<number>(300);
  public readonly filterLocale = input<string | undefined>(undefined);

  // Selection properties
  public readonly selection = input<any>(null);
  public readonly selectionMode = input<'single' | 'multiple' | undefined>(undefined);
  public readonly compareSelectionBy = input<'deepEquals' | 'equals'>('deepEquals');
  public readonly metaKeySelection = input<boolean>(false);
  public readonly contextMenuSelection = input<any>(null);
  public readonly contextMenuSelectionMode = input<'separate' | 'joint'>('separate');

  // Lazy loading properties
  public readonly lazy = input<boolean>(false);
  public readonly lazyLoadOnInit = input<boolean>(true);

  // Scrolling properties
  public readonly scrollable = input<boolean>(false);
  public readonly scrollHeight = input<string | undefined>(undefined);
  public readonly virtualScroll = input<boolean>(false);
  public readonly virtualScrollItemSize = input<number>(0);
  public readonly virtualScrollOptions = input<any>(null);
  public readonly virtualScrollDelay = input<number>(250);

  // Loading properties
  public readonly loading = input<boolean>(false);
  public readonly loadingIcon = input<string>('pi pi-spinner pi-spin');

  // Resize properties
  public readonly resizableColumns = input<boolean>(false);
  public readonly columnResizeMode = input<'fit' | 'expand'>('fit');

  // Reorder properties
  public readonly reorderableColumns = input<boolean>(false);

  // Row grouping properties
  public readonly rowGroupMode = input<'subheader' | 'rowspan' | undefined>(undefined);

  // Export properties
  public readonly exportFilename = input<string>('download');
  public readonly exportFunction = input<any>(null);

  // Row expansion properties
  public readonly expandedRowKeys = input<Record<string, boolean>>({});
  public readonly rowExpandMode = input<'single' | 'multiple'>('multiple');

  // State properties
  public readonly stateKey = input<string | undefined>(undefined);
  public readonly stateStorage = input<'local' | 'session'>('session');

  // Accessibility properties
  public readonly id = input<string | undefined>(undefined);
  public readonly ariaLabel = input<string | undefined>(undefined);

  // Responsive properties
  public readonly breakpoint = input<string>('960px');

  // Custom properties
  public readonly showGridlines = input<boolean>(false);
  public readonly stripedRows = input<boolean>(false);
  public readonly customSort = input<boolean>(false);
  public readonly size = input<'small' | 'large' | undefined>(undefined);
  public readonly rowHover = input<boolean>(true);

  // Events
  public readonly onLazyLoad = output<any>();
  public readonly onPage = output<any>();
  public readonly onSort = output<any>();
  public readonly onFilter = output<any>();
  public readonly onRowSelect = output<any>();
  public readonly onRowUnselect = output<any>();
  public readonly onRowExpand = output<any>();
  public readonly onRowCollapse = output<any>();
  public readonly onContextMenuSelect = output<any>();
  public readonly onColResize = output<any>();
  public readonly onColReorder = output<any>();
  public readonly onRowReorder = output<any>();
  public readonly onEditInit = output<any>();
  public readonly onEditComplete = output<any>();
  public readonly onEditCancel = output<any>();
  public readonly onHeaderCheckboxToggle = output<any>();
  public readonly onStateSave = output<any>();
  public readonly onStateRestore = output<any>();

  // Event handlers
  protected handleLazyLoad(event: any): void {
    this.onLazyLoad.emit(event);
  }

  protected handlePage(event: any): void {
    this.onPage.emit(event);
  }

  protected handleSort(event: any): void {
    this.onSort.emit(event);
  }

  protected handleFilter(event: any): void {
    this.onFilter.emit(event);
  }

  protected handleRowSelect(event: any): void {
    this.onRowSelect.emit(event);
  }

  protected handleRowUnselect(event: any): void {
    this.onRowUnselect.emit(event);
  }

  protected handleRowExpand(event: any): void {
    this.onRowExpand.emit(event);
  }

  protected handleRowCollapse(event: any): void {
    this.onRowCollapse.emit(event);
  }

  protected handleContextMenuSelect(event: any): void {
    this.onContextMenuSelect.emit(event);
  }

  protected handleColResize(event: any): void {
    this.onColResize.emit(event);
  }

  protected handleColReorder(event: any): void {
    this.onColReorder.emit(event);
  }

  protected handleRowReorder(event: any): void {
    this.onRowReorder.emit(event);
  }

  protected handleEditInit(event: any): void {
    this.onEditInit.emit(event);
  }

  protected handleEditComplete(event: any): void {
    this.onEditComplete.emit(event);
  }

  protected handleEditCancel(event: any): void {
    this.onEditCancel.emit(event);
  }

  protected handleHeaderCheckboxToggle(event: any): void {
    this.onHeaderCheckboxToggle.emit(event);
  }

  protected handleStateSave(event: any): void {
    this.onStateSave.emit(event);
  }

  protected handleStateRestore(event: any): void {
    this.onStateRestore.emit(event);
  }
}
