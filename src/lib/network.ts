import os from "os";

export function getLanIP(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const addr of ifaces ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "localhost";
}

// Origin reachable from another device (e.g. a phone) on the same network.
// On Vercel, the deployment URL already works from anywhere. Locally,
// "localhost" only resolves on the host machine itself, so swap in the LAN IP.
export function getShareableOrigin(request: Request): string {
  if (process.env.VERCEL) {
    const url = new URL(request.url);
    return url.origin;
  }
  const port = process.env.PORT ?? "3000";
  return `http://${getLanIP()}:${port}`;
}
