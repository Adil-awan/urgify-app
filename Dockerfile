FROM node:20-alpine

WORKDIR /app

# Copy the backend folder
COPY urgify-backend ./urgify-backend

# Go into backend directory and install dependencies
WORKDIR /app/urgify-backend

# Install dependencies (including devDependencies needed for build)
RUN npm install

# Generate Prisma client with a dummy DB URL to satisfy prisma.config.ts
# The real DATABASE_URL is injected at runtime via Hugging Face Secrets
RUN DATABASE_URL="postgresql://user:pass@localhost:5432/dummy" npx prisma generate

# Compile TypeScript to JavaScript
RUN npm run build

# Grant write permissions for Hugging Face restricted user (uid 1000)
RUN chmod -R 777 /app

# Hugging Face Spaces require the server to run on port 7860
ENV PORT=7860
EXPOSE 7860

# Start the compiled server
CMD ["node", "dist/index.js"]
