const { execSync } = require('child_process');
const port = process.env.PORT || 3001;

try {
  const out = execSync(
    `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique)`,
    { shell: 'powershell.exe', encoding: 'utf8' }
  ).trim();

  if (!out) process.exit(0);

  const pids = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      console.log(`[kill-port] Killed PID ${pid} on port ${port}`);
    } catch {}
  }
} catch {
  // No connections on port — nothing to do
}
