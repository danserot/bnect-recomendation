FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
# Inference is CPU-only; the Linux installer otherwise downloads unused CUDA binaries.
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --no-audit --no-fund

FROM dependencies AS build
COPY backend ./backend
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/backend/package.json ./backend/
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/shared ./shared
RUN mkdir -p /app/output/analytics && chown -R node:node /app/output
USER node
EXPOSE 3001
CMD ["sh", "-c", "node backend/dist/backend/src/cli.js migrate && exec node backend/dist/backend/src/server.js"]

FROM nginx:stable-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
