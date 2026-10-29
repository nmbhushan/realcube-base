FROM node:22-alpine AS build
WORKDIR /app
COPY apps/platform-api/package*.json ./
RUN npm install
COPY apps/platform-api/ ./
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY apps/platform-api/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3001
CMD ["node", "dist/main.js"]
