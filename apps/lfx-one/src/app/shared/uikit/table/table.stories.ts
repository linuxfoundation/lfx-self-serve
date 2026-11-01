// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { UiTableSort } from '@lfx-one/shared/interfaces';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiTableCellDirective } from './table-cell.directive';
import { UiTableComponent } from './table.component';

const rows = [
  { id: 1, name: 'Alex Example', project: 'Kubernetes', role: 'Maintainer', contributions: '1,204' },
  { id: 2, name: 'Sam Sample', project: 'Envoy', role: 'Contributor', contributions: '318' },
  { id: 3, name: 'Jo Placeholder', project: 'OpenSSF', role: 'Board member', contributions: '57' },
  { id: 4, name: 'Pat Testperson', project: 'LFX', role: 'Staff', contributions: '2,931' },
];

const meta: Meta<UiTableComponent> = {
  title: 'Uikit/Table',
  component: UiTableComponent,
  subcomponents: { UiTableCellDirective },
  decorators: [moduleMetadata({ imports: [UiTableComponent, UiTableCellDirective, UiBadgeComponent] })],
  args: {
    label: 'Contributors',
    rowKey: 'id',
    rows,
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'project', header: 'Project', muted: true },
      { key: 'role', header: 'Role' },
      { key: 'contributions', header: 'Contributions', align: 'end' },
    ],
    bordered: false,
    striped: false,
    interactive: false,
    emptyLabel: 'No results',
    footer: null,
    sort: null,
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="max-w-[720px]">
        <lfx-ui-table [label]="label" [columns]="columns" [rows]="rows" [rowKey]="rowKey" [bordered]="bordered" [striped]="striped" [interactive]="interactive" [footer]="footer" [emptyLabel]="emptyLabel" [(sort)]="sort">
          <ng-template lfxUiTableCell="role" let-row><lfx-ui-badge size="sm">{{ row.role }}</lfx-ui-badge></ng-template>
        </lfx-ui-table>
      </div>
    `,
  }),
};
export default meta;
type Story = StoryObj<UiTableComponent>;

export const Basic: Story = {};
export const Bordered: Story = { args: { bordered: true } };
export const Striped: Story = { args: { striped: true } };
export const Interactive: Story = { args: { interactive: true, bordered: true } };
export const WithFooter: Story = { args: { bordered: true, footer: { name: 'Total', contributions: '4,510' } } };
/** The table only reports header clicks; the page reorders `rows` itself, here with a comparator that reads the formatted numbers. */
export const Sortable: Story = {
  render: (args) => {
    const sortRows = (items: Record<string, unknown>[], sort: UiTableSort | null): Record<string, unknown>[] => {
      if (!sort) return items;
      const value = (row: Record<string, unknown>) => String(row[sort.key] ?? '');
      const compare = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const [x, y] = [Number(value(a).replace(/,/g, '')), Number(value(b).replace(/,/g, ''))];
        return Number.isNaN(x) || Number.isNaN(y) ? value(a).localeCompare(value(b)) : x - y;
      };
      return [...items].sort((a, b) => (sort.direction === 'asc' ? compare(a, b) : compare(b, a)));
    };
    return {
      props: {
        ...args,
        rows: sortRows(args.rows, args.sort),
        onSort(this: { sort: UiTableSort | null; rows: Record<string, unknown>[] }, sort: UiTableSort | null) {
          this.sort = sort;
          this.rows = sortRows(args.rows, sort);
        },
      },
      template: `
        <div class="max-w-[720px]">
          <lfx-ui-table [label]="label" [columns]="columns" [rows]="rows" [rowKey]="rowKey" [bordered]="bordered" [sort]="sort" (sortChange)="onSort($event)">
            <ng-template lfxUiTableCell="role" let-row><lfx-ui-badge size="sm">{{ row.role }}</lfx-ui-badge></ng-template>
          </lfx-ui-table>
        </div>
      `,
    };
  },
  args: {
    bordered: true,
    sort: { key: 'contributions', direction: 'desc' },
    columns: [
      { key: 'name', header: 'Name', sortable: true },
      { key: 'project', header: 'Project', muted: true, sortable: true },
      { key: 'role', header: 'Role' },
      { key: 'contributions', header: 'Contributions', align: 'end', sortable: true },
    ],
  },
};
export const Empty: Story = { args: { bordered: true, rows: [], emptyLabel: 'No contributors yet' } };
