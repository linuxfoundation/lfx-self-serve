// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { argsToTemplate, type Meta, moduleMetadata, type StoryObj } from '@storybook/angular';

import { UiAvatarComponent } from '../avatar/avatar.component';
import { UiOptionGroupComponent } from '../select/option-group.component';
import { UiOptionSeparatorComponent } from '../select/option-separator.component';
import { UiOptionComponent } from '../select/option.component';
import { UiComboboxComponent } from './combobox.component';

// Plain rows: `label` is the content when none is projected, and the typed part of it is shown in bold.
const PROJECTS = `
  <lfx-ui-option value="k8s" label="Kubernetes" />
  <lfx-ui-option value="keda" label="KEDA" disabled />
  <lfx-ui-option value="kubeedge" label="KubeEdge" />
  <lfx-ui-option value="kubevirt" label="KubeVirt" />
  <lfx-ui-option value="envoy" label="Envoy" />
  <lfx-ui-option value="prometheus" label="Prometheus" />
  <lfx-ui-option value="sigstore" label="Sigstore" />`;

const meta: Meta<UiComboboxComponent> = {
  title: 'Uikit/Combobox',
  component: UiComboboxComponent,
  subcomponents: { UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent },
  decorators: [moduleMetadata({ imports: [UiComboboxComponent, UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent, UiAvatarComponent] })],
  args: { label: 'Project', placeholder: 'Search projects', emptyText: 'No projects match', size: 'medium' },
  render: (args) => ({ props: args, template: `<div class="w-[320px]"><lfx-ui-combobox ${argsToTemplate(args)}>${PROJECTS}</lfx-ui-combobox></div>` }),
};
export default meta;
type Story = StoryObj<UiComboboxComponent>;

export const Default: Story = {};
export const Chosen: Story = { args: { value: 'envoy' } };
export const WithHint: Story = { args: { hint: 'Type to narrow the list.' } };
export const WithError: Story = { args: { error: 'Choose a project to continue.' } };
export const Disabled: Story = { args: { disabled: true, value: 'envoy' } };
export const NoVisibleLabel: Story = { args: { label: '', ariaLabel: 'Project' } };
export const AllSizes: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="flex w-[320px] flex-col gap-4">
        <lfx-ui-combobox size="tiny" ariaLabel="Tiny" placeholder="Tiny, 24px">${PROJECTS}</lfx-ui-combobox>
        <lfx-ui-combobox size="small" ariaLabel="Small" placeholder="Small, 32px">${PROJECTS}</lfx-ui-combobox>
        <lfx-ui-combobox size="medium" ariaLabel="Medium" placeholder="Medium, 40px">${PROJECTS}</lfx-ui-combobox>
      </div>`,
  }),
};

/** Titles and separators between rows. A group with no matching row is hidden while you type; the separators stay. */
export const Groups: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[320px]">
        <lfx-ui-combobox ${argsToTemplate(args)}>
          <lfx-ui-option-group label="Cloud native">
            <lfx-ui-option value="k8s" label="Kubernetes" />
            <lfx-ui-option value="envoy" label="Envoy" />
          </lfx-ui-option-group>
          <lfx-ui-option-separator />
          <lfx-ui-option-group label="Security">
            <lfx-ui-option value="sigstore" label="Sigstore" />
            <lfx-ui-option value="slsa" label="SLSA" disabled />
          </lfx-ui-option-group>
        </lfx-ui-combobox>
      </div>`,
  }),
};

/** Rows with their own content keep their look. The filter still matches the plain `label`, and only a row without content shows the bold match. The people are synthetic, not real users. */
export const RichOptions: Story = {
  args: { label: 'Owner', placeholder: 'Search people', emptyText: 'No people match' },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-[360px]">
        <lfx-ui-combobox ${argsToTemplate(args)}>
          <lfx-ui-option value="riley" label="Riley Example">
            <span class="flex items-center gap-[10px]">
              <lfx-ui-avatar name="Riley Example" [size]="28" decorative />
              <span class="flex min-w-0 flex-col"><span class="truncate">Riley Example</span><span class="copy-12 truncate text-ui-neutral-600">Maintainer</span></span>
            </span>
          </lfx-ui-option>
          <lfx-ui-option value="sam" label="Sam Sample">
            <span class="flex items-center gap-[10px]">
              <lfx-ui-avatar name="Sam Sample" tone="feature" [size]="28" decorative />
              <span class="flex min-w-0 flex-col"><span class="truncate">Sam Sample</span><span class="copy-12 truncate text-ui-neutral-600">Designer</span></span>
            </span>
          </lfx-ui-option>
        </lfx-ui-combobox>
      </div>`,
  }),
};
