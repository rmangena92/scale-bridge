/**
 * Authentication core — ALL server-only logic (crypto, sessions, DB).
 *
 * This module is imported exclusively from server-function modules
 * (./auth.ts, ./company.ts) whose handlers run only on the server; the client
 * build replaces those handlers with RPC stubs, so this module and its
 * node/neon imports never reach the browser bundle. Do not import this module
 * from client components.
 */
import {
  getCookie,
  getRequest,
  setResponseHeader,
} from "@tanstack/react-start/server";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { sql } from "~/db";
import {
  asService,
  asUser,
  dbConfigured,
  ensureSchema,
  isUniqueViolation,
} from "./db";
import { auditQuery } from "./audit";
import { DEFAULT_ROLE } from "./types";
import type { PublicUser, Role } from "./types";

export const SESSION_COOKIE = "sb_session";
const SESSION_TTL_SECS = 60 * 60 * 24 * 30; // 30 days
const SESSION_TTL_MS = SESSION_TTL_SECS * 1000;

// ---------------------------------------------------------------- passwords
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts[0] !== "scrypt" || parts.length !== 6) return false;
    const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, "base64");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: SCRYPT.maxmem,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ------------------------------------------------------------------ cookies
function isSecureRequest(): boolean {
  try {
    return getRequest().headers.get("x-forwarded-proto") === "https";
  } catch {
    return false;
  }
}

function sessionCookie(token: string, maxAgeSecs: number): string {
  const secure = isSecureRequest() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSecs}${secure}`;
}

const clearSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// -------------------------------------------------------------- session core
/**
 * Validate the request's session cookie against the sessions table and load
 * the user + profile. Returns null when unauthenticated/expired/invalid.
 */
export async function loadSessionUser(): Promise<PublicUser | null> {
  if (!dbConfigured()) return null;
  await ensureSchema();
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256Hex(token);

  const sessionRows = (await asService((tx) => [
    tx`select s.user_id as id, s.expires_at as expires_at, u.email as email
       from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = ${tokenHash}`,
  ]))[0] as { id: string; expires_at: string; email: string }[];
  const session = sessionRows[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await sql()`delete from sessions where token_hash = ${tokenHash}`;
    return null;
  }

  // Profile read uses a placeholder role — the own-profile select policy only
  // needs app.user_id to match; the real role comes back from the row.
  const profileRows = (await asUser(session.id, "guest", (tx) => [
    tx`select role, name, company_id from profiles where user_id = ${session.id}`,
  ]))[1] as { role: Role; name: string | null; company_id: string | null }[];
  const profile = profileRows[0];

  return {
    id: session.id,
    email: session.email,
    role: profile?.role ?? DEFAULT_ROLE,
    name: profile?.name ?? null,
    companyId: profile?.company_id ?? null,
  };
}

async function loadRole(userId: string): Promise<Role> {
  const rows = (await asUser(userId, "guest", (tx) => [
    tx`select role from profiles where user_id = ${userId}`,
  ]))[1] as { role: Role }[];
  return rows[0]?.role ?? DEFAULT_ROLE;
}

// -------------------------------------------------------------------- flows
export type AuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false; error: string; setupRequired?: boolean };

export async function getSessionUserResult(): Promise<{
  user: PublicUser | null;
  setupRequired: boolean;
}> {
  if (!dbConfigured()) return { user: null, setupRequired: true };
  try {
    const user = await loadSessionUser();
    return { user, setupRequired: false };
  } catch (err) {
    console.error("getSessionUser failed:", err);
    return { user: null, setupRequired: false };
  }
}

export async function doSignUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!name) return { ok: false, error: "Enter your name." };

  try {
    await ensureSchema();
    const userId = randomUUID();
    const passwordHash = hashPassword(input.password);
    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await asUser(userId, DEFAULT_ROLE, (tx) => [
      tx`insert into users (id, email, password_hash) values (${userId}, ${email}, ${passwordHash})`,
      tx`insert into profiles (user_id, role, name) values (${userId}, ${DEFAULT_ROLE}, ${name})`,
      tx`insert into sessions (id, user_id, token_hash, expires_at)
         values (${randomUUID()}, ${userId}, ${tokenHash}, ${expiresAt})`,
      auditQuery(tx, userId, "auth.signup", { email }),
    ]);
    setResponseHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_SECS));
    return {
      ok: true,
      user: { id: userId, email, role: DEFAULT_ROLE, name, companyId: null },
    };
  } catch (err) {
    console.error("signUp failed:", err);
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        error: "An account with this email already exists. Try signing in.",
      };
    }
    return { ok: false, error: "Sign-up failed. Please try again." };
  }
}

export async function doSignIn(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { ok: false, error: "Enter your email and password." };
  }

  try {
    await ensureSchema();
    const rows = (await asService((tx) => [
      tx`select u.id, u.email, u.password_hash
         from users u
         where lower(u.email) = ${email}`,
    ]))[0] as { id: string; email: string; password_hash: string }[];
    const account = rows[0];
    if (!account || !verifyPassword(input.password, account.password_hash)) {
      return { ok: false, error: "Invalid email or password." };
    }

    const role = await loadRole(account.id);
    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await asUser(account.id, role, (tx) => [
      tx`insert into sessions (id, user_id, token_hash, expires_at)
         values (${randomUUID()}, ${account.id}, ${tokenHash}, ${expiresAt})`,
      auditQuery(tx, account.id, "auth.signin", { email: account.email }),
    ]);
    setResponseHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_SECS));
    return {
      ok: true,
      user: {
        id: account.id,
        email: account.email,
        role,
        name: null,
        companyId: null,
      },
    };
  } catch (err) {
    console.error("signIn failed:", err);
    return { ok: false, error: "Sign-in failed. Please try again." };
  }
}

export async function doSignOut(): Promise<{ ok: boolean }> {
  try {
    if (dbConfigured()) {
      await ensureSchema();
      const token = getCookie(SESSION_COOKIE);
      if (token) {
        const tokenHash = sha256Hex(token);
        const rows = (await asService((tx) => [
          tx`select s.user_id as id from sessions s where s.token_hash = ${tokenHash}`,
        ]))[0] as { id: string }[];
        const session = rows[0];
        if (session) {
          const role = await loadRole(session.id);
          await asUser(session.id, role, (tx) => [
            tx`delete from sessions where token_hash = ${tokenHash}`,
            auditQuery(tx, session.id, "auth.signout"),
          ]);
        }
      }
    }
  } catch (err) {
    console.error("signOut failed:", err);
  } finally {
    setResponseHeader("Set-Cookie", clearSessionCookie());
  }
  return { ok: true };
}

export async function doUpdateProfile(input: { name: string }): Promise<AuthResult> {
  if (!dbConfigured()) return { ok: false, error: "SETUP_REQUIRED", setupRequired: true };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name cannot be empty." };
  try {
    await ensureSchema();
    const user = await loadSessionUser();
    if (!user) return { ok: false, error: "UNAUTHENTICATED" };
    await asUser(user.id, user.role, (tx) => [
      tx`update profiles set name = ${name}, updated_at = now() where user_id = ${user.id}`,
      auditQuery(tx, user.id, "profile.update", { name }),
    ]);
    return { ok: true, user: { ...user, name } };
  } catch (err) {
    console.error("updateProfile failed:", err);
    return { ok: false, error: "Could not save your profile. Please try again." };
  }
}
