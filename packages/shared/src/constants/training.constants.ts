// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const TRAINING_PRODUCT_TYPE = 'Training' as const;
export const CERTIFICATION_PRODUCT_TYPE = 'Certification' as const;
export type ProductType = typeof TRAINING_PRODUCT_TYPE | typeof CERTIFICATION_PRODUCT_TYPE;

export const CONTINUE_LEARNING_URL = 'https://trainingportal.linuxfoundation.org/learn/dashboard';
export const COURSE_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/learn/course/';
