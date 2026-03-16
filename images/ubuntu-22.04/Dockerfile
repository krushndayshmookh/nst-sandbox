FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Minimal install
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    sudo \
    curl \
    wget \
    vim-tiny \
    nano \
    git \
    net-tools \
    iputils-ping \
    less \
    bash-completion \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && rm -rf /usr/share/doc /usr/share/man /usr/share/locale

# SSH
RUN mkdir -p /run/sshd

# Default student user (overridden at runtime via env vars)
ARG STUDENT_USER=ubuntu
ARG STUDENT_PASS=ubuntu
RUN useradd -m -s /bin/bash -G sudo ${STUDENT_USER} && \
    echo "${STUDENT_USER}:${STUDENT_PASS}" | chpasswd && \
    echo "${STUDENT_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${STUDENT_USER}

# SSH dir
RUN mkdir -p /home/${STUDENT_USER}/.ssh && \
    chown -R ${STUDENT_USER}:${STUDENT_USER} /home/${STUDENT_USER}/.ssh && \
    chmod 700 /home/${STUDENT_USER}/.ssh

# MOTD (static base — dynamic content added at container start by entrypoint)
COPY motd /usr/share/nst-motd-base
RUN chmod -x /etc/update-motd.d/* 2>/dev/null || true

EXPOSE 22 80
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
