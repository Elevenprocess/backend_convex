# syntax=docker/dockerfile:1

# ─── deps ───────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000 \
    || npm install --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000

FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ─── build ─────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
# Vite bakes VITE_* vars at build time, so they must be ARGs, not runtime env.
ARG VITE_API_URL
ARG VITE_REALTIME_URL
ARG VITE_CONVEX_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_REALTIME_URL=$VITE_REALTIME_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── runtime (nginx static SPA) ─────────────────────────────
FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
