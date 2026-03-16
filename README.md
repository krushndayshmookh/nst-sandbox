# NST Sandbox

Self-service Linux container platform for students at Newton School of Technology. Students provision isolated instances with SSH and HTTP access via a CLI installed on their laptops.

## Install

```bash
curl -sL https://sandbox.nstsdc.org/install | bash
```

## Usage

```bash
nst-sandbox create my-devbox     # Interactive: pick image, tier, storage
nst-sandbox ssh my-devbox        # SSH into instance
nst-sandbox list                 # List your instances
nst-sandbox info my-devbox       # Show details
nst-sandbox restart my-devbox    # Restart instance (preserves data)
nst-sandbox destroy my-devbox    # Delete instance permanently
nst-sandbox images               # Show available images and tiers
```

## Images

| ID | Description |
|----|-------------|
| `ubuntu-22.04` | Ubuntu 22.04 LTS — SSH + sudo, install anything with apt. Port 80 exposed for web servers. |
| `alpine-web` | Alpine + nginx + Node.js — lightweight web sandbox with live site on port 80. |

## Compute Tiers

| Tier | vCPU | RAM |
|------|------|-----|
| T1 | 0.5 | 512MB |
| T2 | 1 | 1GB |
| T3 | 2 | 2GB |

## Storage Tiers

| Tier | Size | Notes |
|------|------|-------|
| S1 | 500MB | Quick labs |
| S2 | 1GB | Standard dev |
| S3 | 2GB | Projects |
| S4 | 5GB | Large projects |
| S5 | 10GB | Data-heavy work |

Storage is mounted at `/home/<username>` — your files survive restarts.

## Running a Web Server

Any server you run on port 80 inside your instance is live at:

```
http://<instance-name>.nstsdc.org
```

Example (Node.js):
```bash
node -e "require('http').createServer((req,res)=>res.end('hello')).listen(80)"
```

Example (nginx on ubuntu):
```bash
sudo apt install nginx
sudo service nginx start
```

## Admin

Web UI at `https://sandbox.nstsdc.org/admin` — requires admin key.

Timestamps are shown in IST (Asia/Calcutta).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## Deploy

Build and push images on the cluster node:

```bash
# Container images
sudo docker build -t 192.168.136.145:30500/nst-sandbox-ubuntu:latest images/ubuntu-22.04/
sudo docker push 192.168.136.145:30500/nst-sandbox-ubuntu:latest

sudo docker build -t 192.168.136.145:30500/nst-sandbox-alpine:latest images/alpine-web/
sudo docker push 192.168.136.145:30500/nst-sandbox-alpine:latest

# API image
sudo docker build -t 192.168.136.145:30500/nst-sandbox-api:latest .
sudo docker push 192.168.136.145:30500/nst-sandbox-api:latest

# Apply K8s manifests
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/bastion-deployment.yaml

# Restart API to pick up new image
kubectl rollout restart deployment/sandbox-api -n nst-sandbox-api
```

## License

Internal — NST Software Development Club
