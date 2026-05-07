# syntax=docker/dockerfile:1

# ─── Etapa 1: dependencias base ───────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci


# ─── Etapa 2: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variables NEXT_PUBLIC_* se insertan en el bundle en tiempo de compilación.
# Easypanel las pasa como Build Arguments (Settings → Build → Build Args).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_N1CO_ENV

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_N1CO_ENV=$NEXT_PUBLIC_N1CO_ENV

# Deshabilitar telemetría de Next.js
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ─── Etapa 3: runner (imagen de producción) ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuario sin privilegios para seguridad
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Archivos estáticos públicos
COPY --from=builder /app/public ./public

# Bundle standalone + assets compilados
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Subir el heap de Node a 4GB (default ~1.5GB). Ajustar si la VPS tiene
# menos RAM disponible — en KVM2 (8GB) deja amplio margen.
ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["node", "server.js"]
