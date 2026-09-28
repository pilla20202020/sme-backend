# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src
COPY prisma ./prisma
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY .env ./.env
RUN npx prisma generate
RUN npx nest build 2>&1; echo "Exit: $?"
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/.env ./.env
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./prisma.config.ts

COPY --chown=node:node entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R node:node /app

EXPOSE 3000

# Run as the built-in non-root user shipped with the node image
USER node

ENTRYPOINT ["sh", "entrypoint.sh"]
