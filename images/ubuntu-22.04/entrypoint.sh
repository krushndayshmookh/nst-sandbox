#!/bin/bash
# entrypoint.sh — Ubuntu 22.04 sandbox container entrypoint.
set -e

USERNAME="${STUDENT_USER:-ubuntu}"
PASSWORD="${STUDENT_PASS:-ubuntu}"
INSTANCE_NAME="${STUDENT_USER:-sandbox}"

# Create user if doesn't exist
if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash -G sudo "$USERNAME"
    echo "$USERNAME:$PASSWORD" | chpasswd
    echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/"$USERNAME"
    chmod 440 /etc/sudoers.d/"$USERNAME"

    mkdir -p /home/$USERNAME/.ssh
    chown -R $USERNAME:$USERNAME /home/$USERNAME/.ssh
    chmod 700 /home/$USERNAME/.ssh

    # Prompt
    echo "PS1=\"\\[\\e[32m\\]\\u@$INSTANCE_NAME\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ \"" >> /home/$USERNAME/.bashrc
fi

# Configure SSH
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config 2>/dev/null || true

# Generate host keys if missing
ssh-keygen -A 2>/dev/null

# --- Static MOTD (generated once at container start) ---
MEM_TOTAL_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
MEM_TOTAL_MB=$(( MEM_TOTAL_KB / 1024 ))
CPUS=$(nproc)
DISK=$(df -h /home 2>/dev/null | awk 'NR==2 {print $2}')
STARTED=$(date '+%a %b %e %H:%M:%S %Z %Y')

cat /etc/motd > /etc/motd.dynamic
cat >> /etc/motd.dynamic << MOTD

  Instance:    $INSTANCE_NAME
  Started:     $STARTED
  CPUs:        $CPUS
  Memory:      ${MEM_TOTAL_MB} MB
  Storage:     $DISK
  URL:         http://$INSTANCE_NAME.nstsdc.org

MOTD

# --- Dynamic section (runs on every login) ---
cat > /etc/profile.d/nst-motd.sh << 'PROFILE'
echo "  Uptime:     $(uptime -p)"
echo "  Load:       $(cut -d' ' -f1-3 /proc/loadavg)"
echo ""
PROFILE
chmod +x /etc/profile.d/nst-motd.sh

# Show static MOTD on login
echo 'cat /etc/motd.dynamic 2>/dev/null' > /etc/profile.d/nst-banner.sh
chmod +x /etc/profile.d/nst-banner.sh

# Start SSH in foreground
exec /usr/sbin/sshd -D -e
