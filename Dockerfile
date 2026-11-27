# Game server image (the client is a static site on Vercel). Works on any container host: Render, Fly.io, Railway, a VPS.
#   docker build -t smash-server . && docker run -p 2567:2567 smash-server
FROM node:22-slim
WORKDIR /app
RUN corepack enable

# Manifests first, so dependency installation is cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/content/package.json packages/content/
COPY packages/protocol/package.json packages/protocol/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile --filter "@smash/server..."

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server

# Hosts usually inject PORT; 2567 is the default for local runs.
ENV PORT=2567
EXPOSE 2567
CMD ["pnpm", "--filter", "@smash/server", "start"]
