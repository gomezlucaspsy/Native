// Minimal Google OAuth2 + Drive client. Hand-rolled with fetch (no
// `googleapis` dependency) since the only need here is: connect one Google
// account, and upload files QuickShare already has to Drive.
//
// Like the rest of control-plane.ts, the token is kept in a globalThis
// singleton — no database. It resets on server restart, matching this
// project's "local tool" design: the user just reconnects.

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export interface GoogleConnection {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
}

declare global {
  var nativeGoogleConnection: GoogleConnection | undefined;
  var nativeGoogleOAuthStates: Map<string, number> | undefined;
}

function pendingStates(): Map<string, number> {
  return (globalThis.nativeGoogleOAuthStates ??= new Map());
}

function getConnectionStore(): GoogleConnection | undefined {
  return globalThis.nativeGoogleConnection;
}

function setConnectionStore(conn: GoogleConnection | undefined) {
  globalThis.nativeGoogleConnection = conn;
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function createAuthUrl(origin: string): string {
  const state = crypto.randomUUID();
  const states = pendingStates();
  states.set(state, Date.now());
  // sweep stale states (10 min TTL) so this map can't grow unbounded
  for (const [key, ts] of states) {
    if (Date.now() - ts > 10 * 60 * 1000) states.delete(key);
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function consumeState(state: string): boolean {
  const states = pendingStates();
  const existed = states.delete(state);
  return existed;
}

export async function exchangeCode(code: string, origin: string): Promise<GoogleConnection> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(origin),
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${data.access_token}` },
  });
  const user = (await userRes.json().catch(() => ({}))) as { email?: string };

  const existing = getConnectionStore();
  const conn: GoogleConnection = {
    accessToken: data.access_token,
    // Google only returns a refresh_token on the first consent; keep the old
    // one on reconnect if a fresh one wasn't issued.
    refreshToken: data.refresh_token ?? existing?.refreshToken ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
    email: user.email ?? existing?.email ?? "connected account",
  };

  setConnectionStore(conn);
  return conn;
}

export function getConnection(): { connected: boolean; email?: string } {
  const conn = getConnectionStore();
  return conn ? { connected: true, email: conn.email } : { connected: false };
}

export function disconnect(): void {
  setConnectionStore(undefined);
}

async function refreshAccessToken(conn: GoogleConnection): Promise<string> {
  if (!conn.refreshToken) throw new Error("no refresh token available");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const updated: GoogleConnection = {
    ...conn,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  setConnectionStore(updated);
  return updated.accessToken;
}

async function getValidAccessToken(): Promise<string | null> {
  const conn = getConnectionStore();
  if (!conn) return null;
  if (Date.now() < conn.expiresAt - 60_000) return conn.accessToken;
  return refreshAccessToken(conn);
}

export async function uploadFileToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ id: string; webViewLink?: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Google Drive is not connected");

  const boundary = `nativeshare-${Date.now()}`;
  const metadata = JSON.stringify({ name: filename });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
