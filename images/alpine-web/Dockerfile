FROM alpine:3.21

# Install essentials: sshd, nginx, node, git, common tools
RUN apk add --no-cache \
    openssh-server \
    nginx \
    nodejs \
    npm \
    git \
    curl \
    bash \
    shadow \
    sudo \
    vim \
    nano \
    && mkdir -p /run/nginx /run/sshd \
    && ssh-keygen -A

# Default nginx config — serves from user's ~/public directory
COPY nginx.conf /etc/nginx/http.d/default.conf

# Startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22 80

ENTRYPOINT ["/entrypoint.sh"]
