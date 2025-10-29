# Zoho AppSail Dockerfile for Next.js App
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (leverage cache)
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Copy source
COPY . .

# Build Next.js app
RUN npm run build

# Expose and run
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]