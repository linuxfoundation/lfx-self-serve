// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { COUNTRIES } from '../constants/countries.constants';

/**
 * Type for country codes
 */
export type CountryCode = (typeof COUNTRIES)[number]['value'];
