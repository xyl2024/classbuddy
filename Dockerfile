# ---- 构建阶段：安装依赖并产出静态资源 dist/ ----
FROM node:22-slim AS build
WORKDIR /app

# 先复制清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# tsc 类型检查 + vite 构建（产物在 dist/）
RUN npm run build

# ---- 运行阶段：只保留运行时依赖与产物 ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# 运行时只需 tsx（跑 server.ts）、express、adm-zip 等 dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 构建产物与入口脚本
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts

# 试卷数据目录（运行时由卷挂载到 /data）
ENV CLASSBUDDY_DATA=/data
VOLUME /data

EXPOSE 3000

# 鉴权通过环境变量 CLASSBUDDY_AUTH 传入（如 user:pass），不设则不开启
# 数据目录固定 /data，端口 3000
CMD ["npm", "run", "start", "--", "--port", "3000", "--data", "/data"]
