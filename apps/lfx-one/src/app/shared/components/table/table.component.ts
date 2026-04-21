// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import {
  AfterContentInit,
  Component,
  computed,
  ContentChild,
  ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
  Signal,
  TemplateRef,
} from '@angular/core';
import { TableModule } from 'primeng/table';

@Component({
  selector: 'lfx-table',
  imports: [NgTemplateOutlet, TableModule],
  templateUrl: './table.component.html',
  styleUrls: ['./table.component.scss'],
})
export class TableComponent implements AfterContentInit {
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

  // Injected services
  private readonly elementRef = inject(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);

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
  public readonly rowsPerPageOptions = input<number[] | undefined>(undefined);
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
  public readonly skeletonColumns = input<number>(0);
  public readonly skeletonRows = input<number>(5);
  protected readonly defaultSkeletonCols = signal<number>(4);

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

  // === Skeleton Computed Signals ===
  protected readonly resolvedSkeletonCols: Signal<number> = computed(() => this.skeletonColumns() || this.columns().length || this.defaultSkeletonCols());

  protected readonly skeletonRowData: Signal<{ idx: number; delay: string; cols: { idx: number; width: string }[] }[]> = this.initSkeletonRowData();

  protected readonly isSinglePage: Signal<boolean> = computed(() => {
    if (!this.paginator()) return false;
    const total = this.totalRecords() > 0 ? this.totalRecords() : this.value().length;
    return total > 0 && total <= this.rows();
  });

  // When loading, swap real data with skeleton placeholder data so PrimeNG renders skeleton rows
  protected readonly displayValue: Signal<any[]> = computed(() => {
    if (this.loading() && !this.loadingBodyTemplate) {
      return this.skeletonRowData();
    }
    return this.value();
  });

  protected readonly isEmpty: Signal<boolean> = computed(() => !this.loading() && this.value().length === 0);

  // === Lifecycle ===
  public ngAfterContentInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Detect column count from header template by counting <th> elements after render
    if (!this.skeletonColumns() && !this.columns().length) {
      setTimeout(() => {
        const thead = (this.elementRef.nativeElement as HTMLElement).querySelector('.p-datatable-thead');
        if (thead) {
          const thCount = thead.querySelectorAll('th').length;
          if (thCount > 0) {
            this.defaultSkeletonCols.set(thCount);
          }
        }
      });
    }
  }

  // Host click handler for row selection
  protected onHostClick(event: MouseEvent): void {
    if (!this.selectionMode()) {
      return;
    }

    const target = event.target as HTMLElement;

    // Check if click is inside a button or interactive element - if so, don't trigger row select
    if (target.closest('button, a, .p-button, [role="button"]')) {
      return;
    }

    const tableElement = this.elementRef.nativeElement as HTMLElement;
    const tbody = tableElement.querySelector('.p-datatable-tbody');

    if (!tbody) {
      return;
    }

    const row = target.closest('tr');
    if (!row || !tbody.contains(row)) {
      return;
    }

    // Get the row index from the data-row-index attribute (stable identifier)
    // Consumers must add [attr.data-row-index]="rowIndex" to their tr elements
    const rowIndexAttr = row.getAttribute('data-row-index');
    if (rowIndexAttr === null) {
      return;
    }

    const rowIndex = parseInt(rowIndexAttr, 10);
    if (isNaN(rowIndex) || rowIndex < 0 || rowIndex >= this.value().length) {
      return;
    }

    const rowData = this.value()[rowIndex];
    this.onRowSelect.emit({
      originalEvent: event,
      data: rowData,
      type: 'row',
      index: rowIndex,
    });
  }

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

  // === Private Initializers ===
  private initSkeletonRowData(): Signal<{ idx: number; delay: string; cols: { idx: number; width: string }[] }[]> {
    const widthMatrix = [
      ['70%', '60%', '50%', '40%', '55%', '45%'],
      ['55%', '75%', '65%', '35%', '60%', '50%'],
      ['80%', '50%', '45%', '55%', '70%', '40%'],
      ['45%', '65%', '70%', '50%', '45%', '55%'],
      ['65%', '55%', '60%', '45%', '65%', '50%'],
    ];

    return computed(() => {
      const numRows = this.skeletonRows();
      const numCols = this.resolvedSkeletonCols();

      return Array.from({ length: numRows }, (_, rowIdx) => ({
        idx: rowIdx,
        delay: `${rowIdx * 0.07}s`,
        cols: Array.from({ length: numCols }, (_unused, colIdx) => ({
          idx: colIdx,
          width: widthMatrix[rowIdx % widthMatrix.length][colIdx % widthMatrix[0].length],
        })),
      }));
    });
  }
}
