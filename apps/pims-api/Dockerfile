FROM node:22-alpine AS build
WORKDIR /workspace/apps/pims-api
COPY apps/pims-api/package*.json ./
RUN npm install --include=dev --no-audit --no-fund
COPY apps/pims-api/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/pims-api/package*.json ./
COPY --from=build --chown=node:node /workspace/apps/pims-api/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/pims-api/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
