#!/usr/bin/env bash
set -euo pipefail
image=$1
arch=$2
container=$(docker run -d --platform "linux/$arch" "$image")
cleanup() {
  result=$?
  docker logs --tail 60 "$container" || true
  # Auto-removal after `docker stop` can still be pending when the caller removes
  # the image. Explicit removal waits until this test container is gone.
  if ! docker rm --force --volumes "$container" >/dev/null; then
    echo "Could not remove smoke-test container $container" >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT
for ((attempt=0; attempt<60; attempt++)); do
  # Exercise the gateway, rendered dashboard, and one emitted static asset.
  if docker exec "$container" node --input-type=module -e '
    const base="http://127.0.0.1:3010";
    const health=await fetch(base+"/health");
    if(!health.ok)process.exit(1);
    const {verifyFirstRun,verifyDashboardBuild}=await import("./tools/release/verify-startup.ts");
    await verifyFirstRun(base,"http://127.0.0.1:3030");
    await verifyDashboardBuild(process.cwd());
    const {verifyHTTPS}=await import("./tools/hosting/verify-https.mts");
    await verifyHTTPS("/data",3443);
    // All checks finished; Vinext keeps background cache timers after server close.
    await new Promise(resolve=>setTimeout(resolve,100));
    process.exit(0);
  ' >/dev/null 2>&1; then
    echo "Party Console startup passed on $arch"
    exit 0
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" != true ]]; then break; fi
  sleep 5
done
echo "Party Console startup failed on $arch" >&2
exit 1
