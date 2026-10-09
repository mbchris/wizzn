# API + worker image (same image, different command)
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
# Use --frozen-lockfile once pnpm-lock.yaml is committed
RUN pnpm install
COPY packages/shared packages/shared
COPY packages/api packages/api
RUN pnpm --filter @wizzn/shared build && pnpm --filter @wizzn/api build
RUN pnpm deploy --filter @wizzn/api --prod --legacy /out && cp -r packages/api/dist packages/api/drizzle /out/

FROM base AS runtime
ENV NODE_ENV=production
# ffmpeg: WAV → MP3 for audio units
RUN apk add --no-cache ffmpeg
COPY --from=build /out /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/server.js"]
