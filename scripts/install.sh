#!/bin/bash
# NST Sandbox installer
# Usage: curl -sL https://sandbox.nstsdc.org/install | bash
set -euo pipefail

API_URL="https://sandbox.nstsdc.org"
INSTALL_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.local/bin"

echo "🎓 NST Sandbox — Setting up your environment"
echo ""

# ── Detect OS ────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  *)      echo "❌ Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
esac

# ── Install cloudflared ──────────────────────────────────

install_cloudflared() {
  if command -v cloudflared &>/dev/null; then
    echo "✅ cloudflared already installed ($(cloudflared --version 2>&1 | head -1))"
    return 0
  fi

  echo "📦 Installing cloudflared..."

  if [[ "$PLATFORM" == "darwin" ]]; then
    if command -v brew &>/dev/null; then
      brew install cloudflared 2>/dev/null && echo "✅ cloudflared installed via Homebrew" && return 0
    fi
    # Direct download fallback
    local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}.tgz"
    curl -sL "$url" | tar xz -C /tmp
    if [[ -w "$INSTALL_DIR" ]]; then
      mv /tmp/cloudflared "$INSTALL_DIR/"
    else
      sudo mv /tmp/cloudflared "$INSTALL_DIR/"
    fi
  elif [[ "$PLATFORM" == "linux" ]]; then
    local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}"
    curl -sL "$url" -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    if [[ -w "$INSTALL_DIR" ]]; then
      mv /tmp/cloudflared "$INSTALL_DIR/"
    else
      sudo mv /tmp/cloudflared "$INSTALL_DIR/" 2>/dev/null || {
        mkdir -p "$FALLBACK_DIR"
        mv /tmp/cloudflared "$FALLBACK_DIR/"
        echo "   Installed to $FALLBACK_DIR/cloudflared"
      }
    fi
  fi

  if command -v cloudflared &>/dev/null; then
    echo "✅ cloudflared installed"
  else
    echo "⚠️  Could not install cloudflared automatically."
    echo "   Install it manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    echo "   SSH will not work without cloudflared."
  fi
}

install_cloudflared

# ── Install nst-sandbox CLI ──────────────────────────────

echo ""
echo "📦 Installing nst-sandbox CLI..."

SCRIPT=$(curl -sf "$API_URL/client" 2>/dev/null)
if [[ -z "$SCRIPT" ]]; then
    echo "❌ Failed to download CLI. Check your internet connection."
    exit 1
fi

if [[ -w "$INSTALL_DIR" ]] || sudo -n true 2>/dev/null; then
    echo "$SCRIPT" | sudo tee "$INSTALL_DIR/nst-sandbox" > /dev/null
    sudo chmod +x "$INSTALL_DIR/nst-sandbox"
    echo "✅ nst-sandbox installed to $INSTALL_DIR/nst-sandbox"
else
    mkdir -p "$FALLBACK_DIR"
    echo "$SCRIPT" > "$FALLBACK_DIR/nst-sandbox"
    chmod +x "$FALLBACK_DIR/nst-sandbox"
    echo "✅ nst-sandbox installed to $FALLBACK_DIR/nst-sandbox"
fi

# ── Install nst-ssh alias ───────────────────────────────

echo ""
echo "📦 Setting up nst-ssh command..."

NST_SSH_SCRIPT='#!/bin/bash
# nst-ssh — SSH into NST sandbox through Cloudflare tunnel
# Usage: nst-ssh <roll>@sandbox.nstsdc.org
#        nst-ssh <roll>

set -euo pipefail

if ! command -v cloudflared &>/dev/null; then
  echo "❌ cloudflared is not installed. Run: curl -sL https://sandbox.nstsdc.org/install | bash"
  exit 1
fi

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  # Try to read from config
  CONFIG="$HOME/.nst-sandbox/config.json"
  if [[ -f "$CONFIG" ]]; then
    ROLL=$(grep -o "\"id\": *\"[^\"]*\"" "$CONFIG" | head -1 | sed "s/.*: *\"//;s/\"$//")
    if [[ -n "$ROLL" ]]; then
      INPUT="$ROLL"
    fi
  fi
  if [[ -z "$INPUT" ]]; then
    echo "Usage: nst-ssh <roll-number>"
    echo "       nst-ssh <roll>@sandbox.nstsdc.org"
    exit 1
  fi
fi

# Parse user@host or just user
if [[ "$INPUT" == *"@"* ]]; then
  USER="${INPUT%%@*}"
  HOST="${INPUT#*@}"
else
  USER="$INPUT"
  HOST="sandbox-ssh.nstsdc.org"
fi

echo "🔌 Connecting to sandbox: $USER"
exec ssh -o ProxyCommand="cloudflared access ssh --hostname $HOST" "$USER@$HOST"
'

if [[ -w "$INSTALL_DIR" ]] || sudo -n true 2>/dev/null; then
    echo "$NST_SSH_SCRIPT" | sudo tee "$INSTALL_DIR/nst-ssh" > /dev/null
    sudo chmod +x "$INSTALL_DIR/nst-ssh"
    echo "✅ nst-ssh installed to $INSTALL_DIR/nst-ssh"
else
    mkdir -p "$FALLBACK_DIR"
    echo "$NST_SSH_SCRIPT" > "$FALLBACK_DIR/nst-ssh"
    chmod +x "$FALLBACK_DIR/nst-ssh"
    echo "✅ nst-ssh installed to $FALLBACK_DIR/nst-ssh"
fi

# ── PATH check ───────────────────────────────────────────

if [[ -d "$FALLBACK_DIR" ]] && [[ ":$PATH:" != *":$FALLBACK_DIR:"* ]]; then
    echo ""
    echo "⚠️  Add this to your shell profile (~/.bashrc or ~/.zshrc):"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ── Done ─────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 All set! Here's how to get started:"
echo ""
echo "  1. Create your sandbox:"
echo "     nst-sandbox <your-roll-number>"
echo ""
echo "  2. SSH into it:"
echo "     nst-ssh <your-roll-number>"
echo ""
echo "  3. Deploy your website:"
echo "     Edit ~/public/index.html inside the sandbox"
echo "     Visit http://<your-roll>.nstsdc.org"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
