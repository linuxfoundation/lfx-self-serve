// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TSHIRT_SIZES } from '../constants/tshirt-sizes.constants';

/**
 * Type for T-shirt size values
 */
export type TShirtSize = (typeof TSHIRT_SIZES)[number]['value'];
