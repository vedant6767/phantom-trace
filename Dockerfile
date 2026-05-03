FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json .
RUN npm install
COPY frontend/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package.json .
RUN npm install --omit=dev
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY files/ ./files/

# Generate challenge files at build time
RUN node files/generate_files.js

EXPOSE 3000
CMD ["node", "server.js"]
