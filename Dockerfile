# Dockerfile — NST Sandbox v2 API server
# Build context: repo root
# Usage: docker build -t nst-sandbox-api .
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ curl \
    && curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl && mv kubectl /usr/local/bin/

WORKDIR /app

COPY api/package.json api/
RUN cd api && npm install --production

COPY api/ api/
COPY k8s/instance-template.yaml k8s/instance-template.yaml
COPY public/ public/
COPY admin/ admin/
COPY client/ client/

ENV PORT=3000
WORKDIR /app/api
EXPOSE 3000
CMD ["node", "server.js"]
