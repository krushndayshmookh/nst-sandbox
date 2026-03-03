#!/bin/bash
# NST Sandbox v2 installer
# Usage: curl -sL https://sandbox.nstsdc.org/install | bash
set -euo pipefail

API_URL="https://sandbox.nstsdc.org"
INSTALL_DIR="/usr/local/bin"
FALLBACK_DIR="$HOME/.local/bin"

echo "🎓 NST Sandbox — Installing CLI tools"
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

# ── Check python3 ────────────────────────────────────────

if ! command -v python3 &>/dev/null; then
    echo "⚠️  python3 not found. The CLI needs python3 for JSON handling."
    echo "   Install it and re-run this installer."
    exit 1
fi

# ── Install cloudflared ──────────────────────────────────

if command -v cloudflared &>/dev/null; then
    echo "✅ cloudflared already installed"
else
    echo "📦 Installing cloudflared..."
    if [[ "$PLATFORM" == "darwin" ]]; then
        if command -v brew &>/dev/null; then
            brew install cloudflared 2>/dev/null && echo "✅ cloudflared installed via Homebrew"
        else
            local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${ARCH}.tgz"
            curl -sL "$url" | tar xz -C /tmp
            sudo mv /tmp/cloudflared "$INSTALL_DIR/" 2>/dev/null || { mkdir -p "$FALLBACK_DIR"; mv /tmp/cloudflared "$FALLBACK_DIR/"; }
            echo "✅ cloudflared installed"
        fi
    elif [[ "$PLATFORM" == "linux" ]]; then
        curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /tmp/cloudflared
        chmod +x /tmp/cloudflared
        sudo mv /tmp/cloudflared "$INSTALL_DIR/" 2>/dev/null || { mkdir -p "$FALLBACK_DIR"; mv /tmp/cloudflared "$FALLBACK_DIR/"; }
        echo "✅ cloudflared installed"
    fi
fi

# ── Install nst-sandbox CLI ──────────────────────────────

echo ""
echo "📦 Installing nst-sandbox CLI..."

SCRIPT=$(curl -sf "$API_URL/client" 2>/dev/null) || { echo "❌ Failed to download CLI from $API_URL"; exit 1; }

if [[ -w "$INSTALL_DIR" ]] || sudo -n true 2>/dev/null; then
    echo "$SCRIPT" | sudo tee "$INSTALL_DIR/nst-sandbox" > /dev/null
    sudo chmod +x "$INSTALL_DIR/nst-sandbox"
    echo "✅ nst-sandbox installed to $INSTALL_DIR/nst-sandbox"
else
    mkdir -p "$FALLBACK_DIR"
    echo "$SCRIPT" > "$FALLBACK_DIR/nst-sandbox"
    chmod +x "$FALLBACK_DIR/nst-sandbox"
    echo "✅ nst-sandbox installed to $FALLBACK_DIR/nst-sandbox"
    if [[ ":$PATH:" != *":$FALLBACK_DIR:"* ]]; then
        echo "⚠️  Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
fi

# ── Done ─────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 Installed! Get started:"
echo ""
echo "  nst-sandbox create my-devbox"
echo "  nst-sandbox ssh my-devbox"
echo ""
echo "  Docs: https://sandbox.nstsdc.org"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
