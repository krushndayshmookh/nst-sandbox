# NST Sandbox

Self-service Linux container platform for students at Newton School of Technology. Students provision isolated instances with SSH and HTTP access via a CLI.

## Install

```bash
curl -sL https://sandbox.nstsdc.org/install | bash
```

## Usage

```bash
nst-sandbox create my-devbox     # Interactive: pick image, tier, storage
nst-sandbox ssh my-devbox         # SSH in
nst-sandbox list                  # List your instances
nst-sandbox info my-devbox        # Show details
nst-sandbox destroy my-devbox     # Delete
nst-sandbox images                # Available images and tiers
```

## Images

| ID | Description |
|----|-------------|
| `ubuntu-22.04` | Ubuntu 22.04 LTS minimal — SSH + sudo, install anything with apt |
| `alpine-web` | Alpine + nginx + Node.js — web sandbox with live site |

## Compute Tiers

| Tier | vCPU | RAM |
|------|------|-----|
| T1 | 0.5 | 512MB |
| T2 | 1 | 1GB |
| T3 | 2 | 2GB |

## Storage Tiers

S1: 500MB · S2: 1GB · S3: 2GB · S4: 5GB · S5: 10GB

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## Deploy

```bash
# Build API image (from repo root)
docker build -t localhost:30500/nst-sandbox-api:latest .
docker push localhost:30500/nst-sandbox-api:latest

# Build container images
docker build -t localhost:30500/nst-sandbox-ubuntu:latest images/ubuntu-22.04/
docker build -t localhost:30500/nst-sandbox-alpine:latest images/alpine-web/

# Deploy to K8s
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/bastion-deployment.yaml
```

## Admin

Web UI at `sandbox.nstsdc.org/admin` (requires admin key).

## License

Internal — NST Software Development Club
