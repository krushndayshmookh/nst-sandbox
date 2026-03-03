const ssh2 = require('ssh2');
const { execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.SSH_PORT || 2222;
const HOST_KEY = process.env.HOST_KEY || '/etc/ssh/ssh_host_ed25519_key';

function getStudentSSH(username) {
  try {
    const json = execSync(
      `kubectl get svc sandbox-ssh -n sandbox-${username} -o json`,
      { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();
    const svc = JSON.parse(json);
    return { host: svc.spec.clusterIP, port: svc.spec.ports[0].port };
  } catch {
    return null;
  }
}

function sandboxExists(username) {
  try {
    execSync(`kubectl get namespace sandbox-${username}`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function ensureHostKey() {
  if (!fs.existsSync(HOST_KEY)) {
    execSync(`ssh-keygen -t ed25519 -f ${HOST_KEY} -N "" -q`);
  }
  return fs.readFileSync(HOST_KEY);
}

const hostKey = ensureHostKey();

const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
  let username = '';
  let upstreamConn = null;
  let ptyInfo = null;

  client.on('authentication', (ctx) => {
    username = ctx.username.toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (ctx.method === 'none') {
      return ctx.reject(['password']);
    }

    if (ctx.method === 'password') {
      if (!sandboxExists(username)) {
        console.log(`[${ts()}] Auth failed: no sandbox '${username}'`);
        return ctx.reject(['password']);
      }

      const upstream = getStudentSSH(username);
      if (!upstream) {
        console.log(`[${ts()}] Auth failed: no service '${username}'`);
        return ctx.reject(['password']);
      }

      upstreamConn = new ssh2.Client();

      upstreamConn.on('ready', () => {
        console.log(`[${ts()}] Auth OK: ${username} → ${upstream.host}:${upstream.port}`);
        ctx.accept();
      });

      upstreamConn.on('error', (err) => {
        console.log(`[${ts()}] Auth failed '${username}': ${err.message}`);
        ctx.reject(['password']);
      });

      upstreamConn.on('close', () => {
        client.end();
      });

      upstreamConn.connect({
        host: upstream.host,
        port: upstream.port,
        username: username,
        password: ctx.password,
        readyTimeout: 10000,
      });

      return;
    }

    ctx.reject(['password']);
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();

      session.on('pty', (accept, reject, info) => {
        ptyInfo = info;
        accept && accept();
      });

      session.on('window-change', (accept, reject, info) => {
        // Will be handled if we store the upstream stream
        accept && accept();
      });

      session.on('shell', (accept) => {
        const clientStream = accept();

        const opts = ptyInfo
          ? { term: ptyInfo.term || 'xterm-256color', cols: ptyInfo.cols, rows: ptyInfo.rows }
          : { term: 'xterm-256color' };

        upstreamConn.shell(opts, (err, upstreamStream) => {
          if (err) {
            clientStream.write('Failed to open shell.\r\n');
            clientStream.exit(1);
            clientStream.end();
            return;
          }

          clientStream.pipe(upstreamStream);
          upstreamStream.pipe(clientStream);

          upstreamStream.on('close', () => {
            clientStream.exit(0);
            clientStream.end();
          });

          clientStream.on('close', () => {
            upstreamConn.end();
          });
        });
      });

      session.on('exec', (accept, reject, info) => {
        const clientStream = accept();

        upstreamConn.exec(info.command, (err, upstreamStream) => {
          if (err) {
            clientStream.stderr.write('Failed to execute command.\r\n');
            clientStream.exit(1);
            clientStream.end();
            return;
          }

          clientStream.pipe(upstreamStream);
          upstreamStream.pipe(clientStream);

          if (upstreamStream.stderr) {
            upstreamStream.stderr.pipe(clientStream.stderr);
          }

          upstreamStream.on('exit', (code, signal) => {
            clientStream.exit(code != null ? code : (signal ? 1 : 0));
            clientStream.end();
          });

          upstreamStream.on('close', () => {
            client.end();
          });
        });
      });
    });
  });

  client.on('error', () => {});
  client.on('end', () => {
    if (upstreamConn) upstreamConn.end();
  });
});

function ts() {
  return new Date().toISOString();
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🔐 SSH Bastion listening on port ${PORT}`);
  console.log(`   Students connect: ssh <roll>@sandbox-ssh.nstsdc.org`);
});
