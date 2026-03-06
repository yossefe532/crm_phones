FROM node:20-bullseye-slim AS client-build

WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-bullseye-slim

WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
COPY --from=client-build /client/dist ./public

ENV NODE_ENV=production
ENV PORT=10000
ENV DATABASE_URL=file:/var/data/dev.db

EXPOSE 10000

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node prisma/seed.js && node server.js"]
