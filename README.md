# NST Sandbox

Isolated container sandboxes for students to deploy websites on the NST cluster.

Each student gets their own container with SSH access, nginx, Node.js, and a persistent home directory. Websites are accessible at `<student-id>.nstsdc.org`.

## Architecture

```
Student → SSH (port 30xxx) → K8s NodePort → Student Pod (Alpine + sshd + nginx + node)
Browser → <id>.nstsdc.org → Traefik Ingress → Student Pod :80
```

**Per-student resources:** 128MB RAM, 200m CPU, 512MB storage

## Setup

### 1. Build and push the container image

```bash
cd docker/
docker build -t registry.nstsdc.org/nst-sandbox:latest .
docker push registry.nstsdc.org/nst-sandbox:latest
```

Or if using a local registry / containerd import:
```bash
docker build -t nst-sandbox:latest .
docker save nst-sandbox:latest | ssh nst-n1 'sudo k3s ctr images import -'
```

### 2. Install the CLI on the cluster

```bash
scp scripts/nst-sandbox nst-n1:/usr/local/bin/
ssh nst-n1 'chmod +x /usr/local/bin/nst-sandbox'
scp -r templates/ nst-n1:/opt/nst-sandbox/templates/
```

Update `TEMPLATE` path in the script to `/opt/nst-sandbox/templates/sandbox-pod.yaml`.

### 3. DNS Setup

Add a wildcard DNS record:
```
*.nstsdc.org → cluster ingress IP
```

## CLI Usage

```bash
# Create a single sandbox
nst-sandbox create john-doe
# Output: SSH command, password, web URL

# Bulk provision from CSV
nst-sandbox bulk students.csv

# List all active sandboxes
nst-sandbox list

# Check a student's usage
nst-sandbox info john-doe

# Reset (fresh start, new password)
nst-sandbox reset john-doe

# Stop (preserves data, frees resources)
nst-sandbox stop john-doe

# Delete permanently
nst-sandbox delete john-doe
```

### CSV format for bulk provisioning

```csv
john-doe
jane-smith,custompassword
roll-2024001
roll-2024002,secretpass
```

Credentials are saved to `sandbox-credentials-<timestamp>.txt`.

## Student Instructions

After receiving credentials:

```bash
# Connect to your sandbox
ssh your-id@nst-n1.nstsdc.org -p <your-port>

# Your website files go in ~/public/
cd ~/public
nano index.html

# Your site is live at: http://your-id.nstsdc.org
```

## Resource Limits

| Resource | Per Student | 314 Students |
|----------|-----------|--------------|
| RAM      | 128MB     | ~40GB        |
| CPU      | 200m      | 62 cores (burst) |
| Storage  | 512MB     | ~157GB       |

**Note:** Not all 314 students will be active simultaneously. Use `stop`/`start` to manage active sets.

## Cleanup

```bash
# Stop all sandboxes (preserves data)
for ns in $(kubectl get ns -l app=nst-sandbox -o name); do
  nst-sandbox stop "${ns#namespace/sandbox-}"
done

# Nuclear option: delete everything
for ns in $(kubectl get ns -l app=nst-sandbox -o name); do
  kubectl delete "$ns" --grace-period=5
done
```
