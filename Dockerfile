FROM node:20-alpine

WORKDIR /app

# Copy the backend folder
COPY urgify-backend ./urgify-backend

# Go into backend directory and install dependencies
WORKDIR /app/urgify-backend
RUN npm install

# Build the TypeScript code
RUN DATABASE_URL="postgresql://dummy" npx prisma generate
RUN npm run build

# Hugging Face Spaces require the server to run on port 7860
ENV PORT=7860
EXPOSE 7860

# Start the server
CMD ["npm", "start"]
