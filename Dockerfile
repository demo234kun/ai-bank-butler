FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV COOKIE_SECURE=1
ENV DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
CMD ["npm", "start"]
