// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

module.exports = {
  apps: [
    {
      name: 'lfx-pcc',
      script: 'dist/lfx-pcc/server/server.mjs',
      env: {
        PM2: 'true',
        NODE_ENV: 'production',
        PORT: 4200,
      },
      max_restarts: 10, // Restart limit for unstable apps
      exp_backoff_restart_delay: 100, // Exponential backoff restart delay
      watch: false, // Disable file watching in production
      autorestart: true, // Auto restart on crashes
      instances: 1, // Number of instances to run
      exec_mode: 'cluster', // Enable cluster mode for load balancing
    },
  ],
};
