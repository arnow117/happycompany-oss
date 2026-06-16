module.exports = {
  apps: [{
    name: 'hc-backend',
    script: 'node_modules/.bin/tsx',
    args: 'src/index.ts',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    env: {
      NODE_ENV: 'development'
    },
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 5000,
    max_restarts: 20,
    min_uptime: '10s',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }, {
    name: 'hc-frontend',
    script: './node_modules/.bin/vite',
    args: '--host 127.0.0.1 --strictPort --port 8888',
    cwd: require('path').join(__dirname, 'web'),
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    restart_delay: 2000,
    kill_timeout: 3000,
    max_restarts: 10,
    min_uptime: '5s',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
