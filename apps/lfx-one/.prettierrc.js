// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

module.exports = {
  ...require('@linuxfoundation/lfx-ui-core/prettier-config'),
  overrides: [
    {
      files: '*.html',
      options: {
        parser: 'angular',
      },
    },
  ],
};
