# Multi-stage Dockerfile для будущего деплоя (фаза B+ из PRD §3).
# На фазе A (день 1) запускаем локально через `npm run dev` — этот образ не используется.
# Prisma generate будет добавлен после Дня 2, когда появится schema.prisma.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
