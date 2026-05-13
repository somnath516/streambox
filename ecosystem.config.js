module.exports = {
  apps: [{
    name: 'streambox',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3000,
      ENABLE_CSP: process.env.ENABLE_CSP || '1',
    },
    time: true,
    max_memory_restart: '750M',
    kill_timeout: 8000,
    wait_ready: false,
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    merge_logs: true,
  }],
};
