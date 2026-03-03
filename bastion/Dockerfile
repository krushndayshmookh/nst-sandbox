FROM node:22-alpine

RUN apk add --no-cache openssh-keygen bash curl \
    && mkdir -p /app /etc/ssh

# kubectl for looking up student pods
RUN curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl && mv kubectl /usr/local/bin/

WORKDIR /app
COPY package.json .
RUN npm install --production

COPY server.js .

# Generate host key at build time (will be overridden by volume mount if desired)
RUN ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" -q

EXPOSE 2222

CMD ["node", "server.js"]
