// PM2 process config. The app does NOT self-load .env (no dotenv), so we inject
// it via Node's native --env-file (Node >= 20.6). Run: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'terme-api',
      // Entry emitted by `npm run build`. Verify with: find dist -name index.js
      script: 'dist/src/index.js',
      node_args: '--env-file=.env',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Don't hammer-restart a boot-time crash (bad env, missing build) forever.
      max_restarts: 5,
      min_uptime: '10s',
      env: { NODE_ENV: 'production' },
    },
  ],
};
