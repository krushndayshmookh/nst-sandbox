# NST Sandbox v2 — Architecture

## Overview

NST Sandbox is a self-service cloud platform for students at Newton School of Technology. Students provision isolated Linux containers with SSH and HTTP access via a CLI installed on their laptops. The system runs on the NST K3s cluster.

v2 replaces the original single-image sandbox system with a multi-image, configurable instance platform — the foundation for a campus cloud.

## Key Changes from v1

| Aspect | v1 | v2 |
|--------|----|----|
| Images | Alpine only | Catalog: Ubuntu, Alpine, etc. (server-defined) |
| Instances per student | 1 | Unlimited (tracked, quota-enforceable) |
| Naming | Roll number | Freeform (unique, validated) |
| Specs | Fixed (128MB/200m) | Tiered: T1/T2/T3 compute + S1–S5 storage |
| Storage | 512MB PVC at /home | Separate PVC, configurable 500MB–10GB |
| Lifespan | Permanent | Permanent or 24-hour (CLI flag) |
| Database | Token files on disk | SQLite |
| Admin | CLI only | Web UI at sandbox.nstsdc.org/admin |
| Auth | Token-based self-delete | Same (auth system planned for later) |

## Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                         NST Sandbox v2                               │
│                                                                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │  Client CLI  │──▶│  Backend API │──▶│  K8s (kubectl)           │  │
│  │  (Node.js)   │   │  (Node.js)   │   │  Namespaces, Pods, PVCs  │  │
│  │  curl|bash   │   │  + SQLite    │   │  Services, Ingresses     │  │
│  └─────────────┘   │  + Admin UI  │   └──────────────────────────┘  │
│                     └──────────────┘                                 │
│  ┌─────────────┐                       ┌──────────────────────────┐  │
│  │  SSH Bastion │◀── cloudflared ──────▶│  Student Pods            │  │
│  │  (ssh2 proxy)│                       │  Ubuntu / Alpine / ...   │  │
│  └─────────────┘                       └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1. Client CLI (`nst-sandbox`)

- **Runtime:** Node.js script (installed via `curl -sL https://sandbox.nstsdc.org/install | bash`)
- **Location on student machine:** `/usr/local/bin/nst-sandbox` or `~/.local/bin/nst-sandbox`
- **Config:** `~/.nst-sandbox/config.json` (stores all instance tokens)

#### CLI Commands

```
nst-sandbox create [name]          Interactive: pick image, tier, storage, lifespan
nst-sandbox create [name] --image ubuntu --tier t2 --storage s3 --24h
nst-sandbox list                   List YOUR instances (by stored tokens)
nst-sandbox ssh <name>             SSH into instance
nst-sandbox info <name>            Show instance details
nst-sandbox destroy <name>         Delete instance (requires matching token)
nst-sandbox images                 List available images from server
nst-sandbox --help
```

#### `create` Flow (Interactive)

```
$ nst-sandbox create my-devbox

📦 Available images:
  1. ubuntu-22.04    Ubuntu 22.04 LTS (minimal + SSH)
  2. alpine-web      Alpine + nginx + Node.js + SSH (web sandbox)
  3. ubuntu-ec2      Ubuntu 22.04 EC2 simulator (SSH + sudo apt)

Select image [1-3]: 1

⚙️  Compute tier:
  T1: 0.5 vCPU, 512MB RAM
  T2: 1 vCPU, 1GB RAM
  T3: 2 vCPU, 2GB RAM

Select tier [T1/T2/T3]: T1

💾 Storage (user data, separate from OS):
  S1: 500MB    S2: 1GB    S3: 2GB    S4: 5GB    S5: 10GB

Select storage [S1-S5]: S2

⏱  Lifespan:
  1. Persistent (lives until you destroy it)
  2. 24-hour (auto-deleted after 24 hours)

Select [1/2]: 1

⏳ Provisioning my-devbox...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🎓 Instance: my-devbox

  🖥  Image:    ubuntu-22.04
  ⚙️  Tier:     T1 (0.5 vCPU, 512MB RAM)
  💾  Storage:  S2 (1GB)

  🔑 SSH:      nst-sandbox ssh my-devbox
  🔒 Password: k7m2np4x
  🌐 URL:      http://my-devbox.nstsdc.org

  Connect:     nst-sandbox ssh my-devbox
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2. Backend API (`sandbox.nstsdc.org`)

- **Runtime:** Node.js HTTP server
- **Database:** SQLite (single file, mounted on PVC)
- **Serves:** API endpoints + Admin UI + installer + client CLI script

#### SQLite Schema

```sql
-- Available images (admin-managed)
CREATE TABLE images (
    id TEXT PRIMARY KEY,          -- 'ubuntu-22.04'
    name TEXT NOT NULL,           -- 'Ubuntu 22.04 LTS'
    description TEXT,             -- 'Minimal Ubuntu + SSH'
    docker_image TEXT NOT NULL,   -- 'localhost:30500/nst-sandbox-ubuntu:latest'
    ports TEXT DEFAULT '22',      -- JSON array: [22] or [22, 80]
    default_tier TEXT DEFAULT 'T1',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Running instances
CREATE TABLE instances (
    id TEXT PRIMARY KEY,          -- 'my-devbox' (unique name)
    creator_id TEXT,              -- opaque: hash of machine fingerprint (no auth yet)
    token TEXT NOT NULL,          -- 48-char hex, for owner operations
    image_id TEXT NOT NULL REFERENCES images(id),
    tier TEXT NOT NULL,           -- 'T1', 'T2', 'T3'
    storage TEXT NOT NULL,        -- 'S1'..'S5'
    ephemeral INTEGER DEFAULT 0, -- 1 = 24-hour instance
    password TEXT NOT NULL,
    ssh_port INTEGER,
    namespace TEXT NOT NULL,      -- 'sandbox-<name>'
    status TEXT DEFAULT 'running',-- running, stopped, deleted
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed TEXT,           -- updated on SSH/HTTP activity
    expires_at TEXT,              -- set for 24h instances
    deleted_at TEXT
);

-- Admin config (key-value)
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- e.g., ('purge_inactive_days', '30'), ('admin_key', 'nst-admin-2026')
```

#### API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/images` | List available images + tiers | None |
| `POST` | `/api/instances` | Create instance | None (token returned) |
| `GET` | `/api/instances/:name` | Get instance info | None |
| `DELETE` | `/api/instances/:name` | Destroy instance | Bearer token (owner or admin) |
| `GET` | `/api/instances` | List all instances | Admin |
| `POST` | `/api/instances/:name/stop` | Stop instance | Bearer token |
| `POST` | `/api/instances/:name/start` | Start instance | Bearer token |
| `GET` | `/install` | Installer script | None |
| `GET` | `/client` | Client CLI script | None |
| `GET` | `/health` | Health check | None |
| `GET` | `/admin` | Admin web UI | Admin key (query param or header) |
| `GET` | `/admin/api/*` | Admin API | Admin key |

#### Admin API (all require admin key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/api/instances` | All instances with stats |
| `GET` | `/admin/api/stats` | Cluster summary (total, by image, by tier, resource usage) |
| `DELETE` | `/admin/api/instances/:name` | Force delete |
| `DELETE` | `/admin/api/instances` | Bulk delete (body: `{names: [...]}` or `{filter: "all"}`) |
| `POST` | `/admin/api/purge` | Purge inactive instances older than N days |
| `GET` | `/admin/api/images` | List images |
| `POST` | `/admin/api/images` | Add image to catalog |
| `PUT` | `/admin/api/images/:id` | Update image |
| `DELETE` | `/admin/api/images/:id` | Remove image |
| `GET` | `/admin/api/config` | Get config |
| `PUT` | `/admin/api/config` | Update config |

### 3. Admin Web UI (`sandbox.nstsdc.org/admin`)

Plain HTML + Vue.js. No CSS frameworks. Semantic HTML only.

#### Pages/Views

1. **Dashboard** — total instances, resource usage, instances by image/tier, recent activity
2. **Instances** — table of all instances with: name, creator, image, tier, storage, status, created, last accessed, actions (stop/start/delete). Bulk select + delete. Filter by status/image/age.
3. **Images** — manage image catalog (add/edit/disable images)
4. **Config** — edit admin key, purge threshold, max instances per creator, etc.

### 4. SSH Bastion (unchanged from v1)

- Looks up `sandbox-ssh` service in `sandbox-<name>` namespace
- Proxies SSH connection to pod's ClusterIP
- No changes needed — works with any image that runs sshd

### 5. Container Images

#### Image: `ubuntu-22.04` (the EC2 sim)

Based on the `ec2-sim` Dockerfile we built today. Ubuntu 22.04 minimal with:

- openssh-server, sudo, curl, wget, vim-tiny, nano, git, net-tools
- EC2-style MOTD and prompt
- `--no-install-recommends` to keep it slim (~158MB)
- Student user with NOPASSWD sudo
- Students can `sudo apt install nginx` etc.

#### Image: `alpine-web` (current v1 sandbox)

The existing Alpine image, unchanged. Alpine + sshd + nginx + Node.js + git.

#### Adding new images

1. Write a Dockerfile (must run sshd on port 22, accept `STUDENT_USER` + `STUDENT_PASS` env vars)
2. Build and push to cluster registry
3. Add to image catalog via admin UI or direct SQLite insert
4. Students see it in `nst-sandbox images`

### 6. Tiers & Storage

#### Compute Tiers

| Tier | vCPU (request/limit) | RAM (request/limit) |
|------|---------------------|---------------------|
| T1 | 100m / 500m | 128Mi / 512Mi |
| T2 | 250m / 1000m | 256Mi / 1Gi |
| T3 | 500m / 2000m | 512Mi / 2Gi |

#### Storage Tiers

| Tier | Size | Use Case |
|------|------|----------|
| S1 | 500Mi | Quick labs |
| S2 | 1Gi | Standard dev |
| S3 | 2Gi | Projects |
| S4 | 5Gi | Large projects |
| S5 | 10Gi | Data-heavy work |

Storage PVC is mounted at `/home/<user>`. Container image + apt installs are in the ephemeral layer (lost on pod restart). User files persist.

### 7. K8s Resource Template (per instance)

Same pattern as v1 but with dynamic values:

- Namespace: `sandbox-<name>`
- Pod: image from catalog, resources from tier, env vars for user/pass
- PVC: size from storage tier, mounted at `/home/<user>`
- Service (NodePort): SSH
- Service (ClusterIP): HTTP (port 80)
- Ingress: `<name>.nstsdc.org` → HTTP service
- Labels: `app: nst-sandbox`, `instance: <name>`, `image: <image-id>`, `tier: <tier>`

### 8. Instance Lifecycle

```
create → running → [stop] → stopped → [start] → running → [destroy] → deleted
                                                         ↗
                    running → [24h expires] → deleted ──┘
```

- **Create:** API validates name uniqueness, provisions K8s resources, records in SQLite
- **Stop:** Deletes pod (PVC preserved). Status → stopped.
- **Start:** Re-creates pod from template. Status → running.
- **Destroy:** Deletes entire namespace (pod + PVC + services + ingress). Status → deleted.
- **24h expiry:** Background job checks `expires_at`, deletes expired instances.
- **Purge:** Admin triggers purge of instances with `last_accessed` older than threshold.

### 9. Background Jobs

Running in the API server process (setInterval):

1. **Expiry sweep** (every 5 min): Delete 24h instances past `expires_at`
2. **Status sync** (every 1 min): Check pod status via kubectl, update SQLite
3. **Last-accessed tracking**: Update `last_accessed` on API hits for instance info/ssh (bastion can POST to API on successful auth)

### 10. Networking

| Surface | Route |
|---------|-------|
| SSH | `<name>.ssh.nstsdc.org` → cloudflared tunnel → bastion (30022) → pod ClusterIP:22 |
| HTTP | `<name>.nstsdc.org` → cloudflared tunnel → Traefik → Ingress → pod ClusterIP:80 |
| API | `sandbox.nstsdc.org` → cloudflared tunnel → Traefik → API pod:3000 |

### 11. Directory Structure (repo)

```
nst-sandbox/
├── api/
│   ├── server.js              # Main API server
│   ├── db.js                  # SQLite setup + queries
│   ├── k8s.js                 # kubectl wrapper functions
│   ├── provisioner.js         # Create/delete/stop/start logic
│   ├── jobs.js                # Background expiry + sync
│   └── package.json
├── admin/
│   └── index.html             # Single HTML file: Vue.js + semantic HTML
├── bastion/
│   ├── server.js              # SSH proxy (unchanged from v1)
│   ├── Dockerfile
│   └── package.json
├── images/
│   ├── ubuntu-22.04/
│   │   ├── Dockerfile
│   │   ├── motd
│   │   └── entrypoint.sh
│   ├── alpine-web/
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   └── entrypoint.sh
│   └── README.md              # How to add new images
├── client/
│   ├── nst-sandbox            # Client CLI (Node.js script)
│   └── install.sh             # curl|bash installer
├── k8s/
│   ├── api-deployment.yaml
│   ├── bastion-deployment.yaml
│   └── instance-template.yaml # Template with __PLACEHOLDERS__
├── ARCHITECTURE.md            # This file
├── README.md
└── .gitignore
```

### 12. Migration from v1

1. Existing sandboxes (roll-number namespaces) remain untouched
2. v2 API deployed alongside — new namespace `nst-sandbox-api` already exists
3. Old client CLI replaced by new one (same install URL)
4. Students with existing sandboxes can continue using them
5. Admin can migrate old sandboxes into SQLite via a one-time script
6. Once comfortable, old sandboxes can be bulk-migrated or deleted

### 13. Build & Deploy Order

1. ✅ Ubuntu image (already built and tested as `ec2-sim`)
2. SQLite-backed API server
3. Instance template with tier/storage/image support
4. Client CLI with interactive creation
5. Admin web UI
6. Update bastion to notify API on auth (last_accessed tracking)
7. Background jobs (expiry, sync)
8. Installer script update
9. Deploy to cluster
10. Test end-to-end
11. Push to GitHub

### 14. Future (not in v2)

- Auth (GitHub OAuth, roll number verification)
- Per-creator quotas (max instances, max total resources)
- NixOS images
- VPC-like networking between instances
- Instance snapshots
- GPU-attached instances
- Cost tracking / credit system
- Instance templates (save a configured instance as a new image)

### 15. Student Landing Page (`sandbox.nstsdc.org/`)

Static HTML page served by the API at `/`. Minimal, no frameworks.

**Content:**

- NST Sandbox branding (text only, no images)
- One-liner install command: `curl -sL https://sandbox.nstsdc.org/install | bash`
- Quick usage examples
- Link to GitHub repo (`github.com/nst-sdc/nst-sandbox`)
- Version displayed as short git commit hash (injected at build time via env var `GIT_COMMIT`)

**Implementation:**

- Single `public/index.html` file served by the API
- API reads `GIT_COMMIT` env var (set in K8s deployment from CI or build script)
- Fallback: `dev` if env var not set
