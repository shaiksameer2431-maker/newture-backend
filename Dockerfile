# Production Dockerfile for NECN NEXA Backend
FROM node:22-bullseye-slim

# Install system utilities required for PDF parsing and OCR (poppler-utils for pdftotext/pdftoppm)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --no-audit --no-fund

# Copy backend source code, scripts, models, data, and config
COPY . .

# Build TypeScript code to dist/server.cjs
RUN npm run build

EXPOSE 10000

ENV NODE_ENV=production

CMD ["npm", "start"]
