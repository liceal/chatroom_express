module.exports = {
  apps: [
    {
      name: 'chatroom-express',
      script: './bin/www',
      instances: 1, // 单实例部署以保持 Socket.IO 内存状态与 WebRTC 房间同步
      autorestart: true,
      watch: false, // 生产环境关闭监听，防止上传文件引发重启
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true
    }
  ]
};
