# syntax=docker/dockerfile:1

# ---- Etapa 1: build del front (Vite -> dist/) ----
FROM node:20-slim AS build
WORKDIR /app

# Instala todas las dependencias (incluye devDependencies para vite/tsx).
COPY package.json package-lock.json ./
RUN npm ci

# Copia el código y construye el front estático.
COPY . .
RUN npm run build

# ---- Etapa 2: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# El backend se ejecuta con tsx (TypeScript directo): necesitamos las
# dependencias, el código fuente y el dist/ ya construido.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/agent ./agent
COPY --from=build /app/modulo ./modulo
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/dist ./dist

# Azure Container Apps inyecta el puerto por la variable PORT (default 8787).
ENV PORT=8787
EXPOSE 8787

# Usuario no-root por seguridad.
USER node

CMD ["npm", "run", "start"]
