// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiAvatarComponent } from '../avatar/avatar.component';
import { UiBadgeComponent } from '../badge/badge.component';
import { UiOptionGroupComponent } from './option-group.component';
import { UiOptionSeparatorComponent } from './option-separator.component';
import { UiOptionComponent } from './option.component';
import { UiSelectValueDirective } from './select-value.directive';
import { UiSelectComponent } from './select.component';

// Plain rows: `label` is the content when none is projected.
const FOUNDATIONS = `
  <lfx-ui-option value="cncf" label="Cloud Native Computing Foundation" />
  <lfx-ui-option value="openssf" label="OpenSSF" />
  <lfx-ui-option value="lfai" label="LF AI & Data" disabled />
  <lfx-ui-option value="lfe" label="LF Energy" />
  <lfx-ui-option value="lfn" label="LF Networking" />`;

const meta: Meta<UiSelectComponent> = {
  title: 'Uikit/Select',
  component: UiSelectComponent,
  subcomponents: { UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent, UiSelectValueDirective },
  decorators: [
    moduleMetadata({
      imports: [
        UiSelectComponent,
        UiOptionComponent,
        UiOptionGroupComponent,
        UiOptionSeparatorComponent,
        UiSelectValueDirective,
        UiAvatarComponent,
        UiBadgeComponent,
      ],
    }),
  ],
  args: { label: 'Foundation', placeholder: 'Pick a foundation', size: 'medium' },
  render: (args) => ({ props: args, template: `<div class="w-[320px]"><lfx-ui-select ${argsToTemplate(args)}>${FOUNDATIONS}</lfx-ui-select></div>` }),
};
export default meta;
type Story = StoryObj<UiSelectComponent>;

export const Default: Story = {};
export const Chosen: Story = { args: { value: 'openssf' } };
export const WithHint: Story = { args: { hint: 'The foundation that hosts the project.' } };
export const WithError: Story = { args: { error: 'Choose a foundation to continue.' } };
export const Disabled: Story = { args: { disabled: true, value: 'cncf' } };
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Foundation' } };
export const PrefixIcon: Story = {
  args: { label: 'Region', placeholder: 'Pick a region', prefixIcon: 'fa-light fa-globe' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[320px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <lfx-ui-option value="lisbon" label="Europe (Lisbon)" />
          <lfx-ui-option value="us-east" label="US East" />
          <lfx-ui-option value="tokyo" label="Asia (Tokyo)" />
        </lfx-ui-select>
      </div>`,
  }),
};
export const OptionIcons: Story = {
  args: { label: 'Visibility', value: 'public' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[320px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <lfx-ui-option value="public" label="Public" icon="fa-light fa-globe" />
          <lfx-ui-option value="members" label="Members only" icon="fa-light fa-users" />
          <lfx-ui-option value="private" label="Private" icon="fa-light fa-lock" />
        </lfx-ui-select>
      </div>`,
  }),
};
export const AllSizes: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex w-[320px] flex-col gap-4">
        <lfx-ui-select size="tiny" ariaLabel="Tiny" placeholder="Tiny, 24px" prefixIcon="fa-light fa-globe">${FOUNDATIONS}</lfx-ui-select>
        <lfx-ui-select size="small" ariaLabel="Small" placeholder="Small, 32px" prefixIcon="fa-light fa-globe">${FOUNDATIONS}</lfx-ui-select>
        <lfx-ui-select size="medium" ariaLabel="Medium" placeholder="Medium, 40px" prefixIcon="fa-light fa-globe">${FOUNDATIONS}</lfx-ui-select>
      </div>`,
  }),
};

/** Each option's content is its row: an avatar, a second line and a badge. The `lfxUiSelectValue` template shows the picked person in the trigger. */
export const RichOptions: Story = {
  args: { label: 'Owner', placeholder: 'Pick an owner', value: 'maria' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[360px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <ng-template lfxUiSelectValue let-option>
            <span class="flex min-w-0 items-center gap-[8px]">
              <lfx-ui-avatar [name]="option.label" [size]="20" decorative />
              <span class="truncate">{{ option.label }}</span>
            </span>
          </ng-template>
          <lfx-ui-option value="maria" label="Maria Santos">
            <span class="flex items-center gap-[10px]">
              <lfx-ui-avatar name="Maria Santos" [size]="28" decorative />
              <span class="flex min-w-0 flex-col"><span class="truncate">Maria Santos</span><span class="copy-12 truncate text-ui-neutral-600">Maintainer, 214 commits</span></span>
              <lfx-ui-badge tone="success" size="sm" class="ml-auto">Admin</lfx-ui-badge>
            </span>
          </lfx-ui-option>
          <lfx-ui-option value="nuno" label="Nuno Esteves">
            <span class="flex items-center gap-[10px]">
              <lfx-ui-avatar name="Nuno Esteves" tone="feature" [size]="28" decorative />
              <span class="flex min-w-0 flex-col"><span class="truncate">Nuno Esteves</span><span class="copy-12 truncate text-ui-neutral-600">Designer, 38 commits</span></span>
            </span>
          </lfx-ui-option>
          <lfx-ui-option value="joao" label="João Pires" disabled>
            <span class="flex items-center gap-[10px]">
              <lfx-ui-avatar name="João Pires" [size]="28" decorative />
              <span class="flex min-w-0 flex-col"><span class="truncate">João Pires</span><span class="copy-12 truncate">Left the project</span></span>
            </span>
          </lfx-ui-option>
        </lfx-ui-select>
      </div>`,
  }),
};

/** Titles and separators between options. Each group is a `role="group"` named by its title; arrow keys run through the groups in order. */
export const Groups: Story = {
  args: { label: 'Project', placeholder: 'Pick a project' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[320px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <lfx-ui-option-group label="Cloud native">
            <lfx-ui-option value="k8s" label="Kubernetes" />
            <lfx-ui-option value="envoy" label="Envoy" />
          </lfx-ui-option-group>
          <lfx-ui-option-separator />
          <lfx-ui-option-group label="Security">
            <lfx-ui-option value="sigstore" label="Sigstore" />
            <lfx-ui-option value="slsa" label="SLSA" disabled />
          </lfx-ui-option-group>
          <lfx-ui-option-separator />
          <lfx-ui-option value="other" label="Other" />
        </lfx-ui-select>
      </div>`,
  }),
};

/** A pill trigger with a prefix slot and a value template. */
export const CustomTrigger: Story = {
  args: { ariaLabel: 'Time range', label: '', pill: true, value: '30d' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[240px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <i lfxUiSelectPrefix class="fa-light fa-calendar text-[14px] text-ui-neutral-600" aria-hidden="true"></i>
          <ng-template lfxUiSelectValue let-option>
            <span class="truncate">Last <span class="font-medium">{{ option.label }}</span></span>
          </ng-template>
          <lfx-ui-option value="7d" label="7 days" />
          <lfx-ui-option value="30d" label="30 days" />
          <lfx-ui-option value="90d" label="90 days" />
        </lfx-ui-select>
      </div>`,
  }),
};

/** A search field in the header slot takes focus when the list opens. The page filters its own options; Arrow Down moves to the list and Escape closes. */
export const SearchHeader: Story = {
  args: { label: 'Project', placeholder: 'Pick a project' },
  render: (args) => ({
    props: { ...args, query: '', projects: ['Kubernetes', 'Envoy', 'Sigstore', 'SLSA', 'OpenTelemetry', 'Prometheus'] },
    template: `
      <div class="w-[320px]">
        <lfx-ui-select ${argsToTemplate(args)}>
          <input lfxUiSelectHeader type="search" class="h-ui-small w-full rounded-ui-sm bg-ui-neutral-50 px-[10px] label-14 text-ui-neutral-900 outline-none focus-visible:shadow-focus" aria-label="Search projects" placeholder="Search" (input)="query = $any($event.target).value" />
          @for (project of projects; track project) {
            @if (project.toLowerCase().includes(query.toLowerCase())) {
              <lfx-ui-option [value]="project.toLowerCase()" [label]="project" />
            }
          }
        </lfx-ui-select>
      </div>`,
  }),
};
