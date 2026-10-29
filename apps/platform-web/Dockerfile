FROM node:22-alpine AS build
WORKDIR /app
COPY apps/platform-web/package*.json ./
RUN npm install
COPY apps/platform-web/ ./
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
ENV PLATFORM_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/scripts/production-preflight.mjs ./scripts/production-preflight.mjs
USER app
EXPOSE 3000
CMD ["sh", "-c", "node ./scripts/production-preflight.mjs && exec node server.js"]
