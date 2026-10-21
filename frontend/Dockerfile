# syntax=docker/dockerfile:1
# Build with: docker build -f frontend/Dockerfile frontend   (context = this file's own directory, matching deploy/docker-compose.portal.yml's build.context)

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time,
# not at container start — it MUST be supplied as a build arg, not only
# as a runtime `environment:` entry (see 關鍵技術決策 #2).
ARG NEXT_PUBLIC_BFF_URL
ENV NEXT_PUBLIC_BFF_URL=${NEXT_PUBLIC_BFF_URL}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
