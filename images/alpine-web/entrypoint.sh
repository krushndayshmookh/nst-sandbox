#!/bin/bash
set -e

# Create student user from env vars
USERNAME="${STUDENT_USER:-student}"
PASSWORD="${STUDENT_PASS:-changeme}"

# Create user if doesn't exist
if ! id "$USERNAME" &>/dev/null; then
    adduser -D -s /bin/bash "$USERNAME"
    echo "$USERNAME:$PASSWORD" | chpasswd
    mkdir -p /home/$USERNAME/public
    cat > /home/$USERNAME/public/index.html << 'WELCOME'
<!DOCTYPE html>
<html>
<head>
    <title>NST Sandbox</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
        h1 { color: #6c5ce7; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
        .box { background: #f8f9fa; border-left: 4px solid #6c5ce7; padding: 12px 16px; margin: 16px 0; }
    </style>
</head>
<body>
    <h1>Welcome to your NST Sandbox!</h1>
    <p>This page is served from <code>~/public/index.html</code>.</p>
    <div class="box">
        <strong>Static site:</strong> Put your files in <code>~/public/</code><br>
        <strong>Node/Python app:</strong> Stop nginx, run your server on port 80
    </div>
    <h3>Quick start</h3>
    <p>Edit this file: <code>nano ~/public/index.html</code></p>
    <h3>Run your own server</h3>
    <pre>
# Stop nginx first
sudo nginx -s stop

# Then run your app on port 80
node app.js    # must listen on port 80
python -m http.server 80
    </pre>
    <p>Your site is live at this URL. Happy building!</p>
    <p><img width="96" height="96" src="https://img.icons8.com/external-beshi-flat-kerismaker/96/external-Rocket-startup-beshi-flat-kerismaker.png" alt="external-Rocket-startup-beshi-flat-kerismaker"/></p>
</body>
</html>
WELCOME
    chown -R $USERNAME:$USERNAME /home/$USERNAME

    # Allow student to stop/start nginx and bind to port 80
    echo "$USERNAME ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /bin/kill" >> /etc/sudoers.d/sandbox
    chmod 440 /etc/sudoers.d/sandbox
fi

# Update nginx to serve from this user's public dir
sed -i "s|__HOME__|/home/$USERNAME|g" /etc/nginx/http.d/default.conf

# Configure SSH
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
echo "AllowUsers $USERNAME" >> /etc/ssh/sshd_config

# Let non-root bind to port 80
if [ -f /proc/sys/net/ipv4/ip_unprivileged_port_start ]; then
    echo 0 > /proc/sys/net/ipv4/ip_unprivileged_port_start 2>/dev/null || true
fi

# Start services
nginx
exec /usr/sbin/sshd -D -e
