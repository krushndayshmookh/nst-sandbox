#!/bin/bash
# entrypoint.sh — Ubuntu 22.04 sandbox container entrypoint.
# Creates a student user from env vars, configures SSH, starts sshd.
set -e

USERNAME="${STUDENT_USER:-ubuntu}"
PASSWORD="${STUDENT_PASS:-ubuntu}"

# Create user if doesn't exist
if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo "$USERNAME"
    echo "$USERNAME:$PASSWORD" | chpasswd
    echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/"$USERNAME"
    chmod 440 /etc/sudoers.d/"$USERNAME"

    # SSH dir
    mkdir -p /home/$USERNAME/.ssh
    chown -R $USERNAME:$USERNAME /home/$USERNAME/.ssh
    chmod 700 /home/$USERNAME/.ssh

    # EC2-like prompt
    echo "PS1=\"\\[\\e[32m\\]\\u@ip-172-31-42-\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ \"" >> /home/$USERNAME/.bashrc
    echo 'cat /etc/motd 2>/dev/null' >> /home/$USERNAME/.bashrc
fi

# Configure SSH
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config 2>/dev/null || true

# Update MOTD date
sed -i "s/%DATE%/$(date)/" /etc/motd 2>/dev/null

# Generate SSH host keys if missing
ssh-keygen -A 2>/dev/null

# Start SSH in foreground
exec /usr/sbin/sshd -D -e
