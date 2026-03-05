FROM node:20-alpine AS client-build

WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
COPY --from=client-build /client/dist ./public

ENV NODE_ENV=production
ENV PORT=10000
ENV DATABASE_URL=file:/var/data/dev.db

EXPOSE 10000

CMD ["sh", "-c", "npx prisma db push && node server.js"]
