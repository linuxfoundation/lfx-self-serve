// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagProps, TagSeverity } from './components.interface';

/**
 * Tag type configuration
 * @description Centralized tag styling configuration for common use cases
 */
export interface TagTypeConfig {
  severity: TagProps['severity'];
  icon?: string;
  rounded?: boolean;
  styleClass?: string;
}

/** Resolved label, severity, and icon for a membership status tag displayed in a group header. */
export interface MembershipTagDisplay {
  label: string;
  severity: TagSeverity;
  icon: string;
}
