// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagProps } from './components.interface';

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
