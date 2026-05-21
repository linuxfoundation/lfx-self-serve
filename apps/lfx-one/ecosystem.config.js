// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

module.exports = {
  apps: [
    {
      name: 'lfx-one',
      script: 'dist/lfx-one/server/server.mjs',
      node_args: '--import ./otel.mjs',
      env: {
        PM2: 'true',
        NODE_ENV: 'production',
        PORT: 4000,
      },
      max_restarts: 10, // Restart limit for unstable apps
      exp_backoff_restart_delay: 100, // Exponential backoff restart delay
      watch: false, // Disable file watching in production
      autorestart: true, // Restart on crash (non-zero exit)
      stop_exit_codes: [0], // Do not restart on clean shutdown — process.exit(0) in gracefulShutdown
      instances: 1, // Number of instances to run
      exec_mode: 'cluster', // Enable cluster mode for load balancing
      kill_timeout: 60000, // 15s LB sleep + 25s HTTP drain + 15s service drain (budget-capped) + 5s margin; terminationGracePeriodSeconds (75s) must exceed preStop (10s, inside grace period) + kill_timeout (60s) = 70s
      shutdown_with_message: false, // Use real SIGTERM, not PM2 IPC message
    },
  ],
};
