const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const harness = `
docker() {
  printf '%s\\n' "$*" >> "$TRACE"
  case "$1" in
    run) echo smoke-container ;;
    exec) [[ "$MODE" != failed-check ]] ;;
    inspect) echo false ;;
    logs) [[ "$MODE" != failed-logs ]] ;;
    rm) [[ "$MODE" != failed-removal ]] ;;
    stop) return 0 ;; # Auto-removal is still pending after stop returns.
    *) return 99 ;;
  esac
}
export -f docker
bash "$SMOKE_SCRIPT" fixture-image amd64
`;

for (const [mode, expected] of [['success', 0], ['failed-check', 1], ['failed-logs', 0], ['failed-removal', 1]]) {
  test(`Docker smoke cleanup waits for explicit removal: ${mode}`, () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'party-smoke-cleanup-'));
    const trace = path.join(temporary, 'trace');
    const bash = process.platform === 'win32'
      ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
    try {
      const result = spawnSync(bash, ['-c', harness], {
        encoding: 'utf8', timeout: 15000, windowsHide: true,
        env: { ...process.env, MODE: mode, TRACE: trace.replaceAll('\\', '/'),
          SMOKE_SCRIPT: path.resolve(__dirname, '../ci/smoke-docker.sh').replaceAll('\\', '/') },
      });
      assert.ifError(result.error);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      const calls = readFileSync(trace, 'utf8').trim().split(/\r?\n/);
      assert.equal(calls[0], 'run -d --platform linux/amd64 fixture-image');
      assert.equal(calls.at(-1), 'rm --force --volumes smoke-container');
      assert.ok(calls.includes('logs --tail 60 smoke-container'));
      assert.ok(!calls.some(call => call.startsWith('stop ')));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}
