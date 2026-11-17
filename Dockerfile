# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY vendor ./vendor
RUN npm run build && npm prune --omit=dev

# ---------- run ----------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3790 \
    DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3790') + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
