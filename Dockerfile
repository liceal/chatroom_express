# Dockerfile for chatroom_express production hosting
FROM node:18-alpine

WORKDIR /app

# 复制依赖定义文件
COPY package*.json ./

# 安装生产依赖
RUN npm ci --only=production

# 复制应用程序源码
COPY . .

# 创建持久化上传文件目录
RUN mkdir -p public/file

# 暴露服务端口
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# 启动 Node.js 服务
CMD ["node", "./bin/www"]
