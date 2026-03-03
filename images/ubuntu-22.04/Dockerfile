FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Minimal install — only what's needed, no recommends
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

# Student user
ARG STUDENT_USER=ubuntu
ARG STUDENT_PASS=ubuntu
RUN useradd -m -s /bin/bash -G sudo ${STUDENT_USER} && \
    echo "${STUDENT_USER}:${STUDENT_PASS}" | chpasswd && \
    echo "${STUDENT_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${STUDENT_USER}

# Fake EC2 metadata
RUN mkdir -p /etc/cloud && \
    echo '{"instance_id":"i-0a1b2c3d4e5f67890","instance_type":"t2.micro","region":"ap-south-1"}' > /etc/cloud/instance-metadata.json

# MOTD
COPY motd /etc/motd
RUN chmod -x /etc/update-motd.d/* 2>/dev/null || true

# SSH dir
RUN mkdir -p /home/${STUDENT_USER}/.ssh && \
    chown -R ${STUDENT_USER}:${STUDENT_USER} /home/${STUDENT_USER}/.ssh && \
    chmod 700 /home/${STUDENT_USER}/.ssh

# EC2-like prompt
RUN echo 'PS1="\[\e[32m\]\u@ip-172-31-42-\h\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]\$ "' >> /home/${STUDENT_USER}/.bashrc && \
    echo 'cat /etc/motd 2>/dev/null' >> /home/${STUDENT_USER}/.bashrc

EXPOSE 22
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
