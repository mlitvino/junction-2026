// HTTP client for the e2e scenarios: one Session per signed-in user (its own cookie jar), every
// request against the running server at E2E_BASE_URL. Responses are checked against the shared
// Zod contracts, so a scenario also fails when the API drifts from src/shared/contracts.
import assert from "node:assert/strict";

import type { z } from "zod";

export const BASE_URL = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const PASSWORD = "e2e-password";

export type Reply = { status: number; body: unknown };

const MAX_RATE_LIMIT_RETRIES = 12;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Session {
  label: string;
  username: string | null = null;
  private cookies = new Map<string, string>();

  constructor(label: string) {
    this.label = label;
  }

  async call(method: string, path: string, body?: unknown): Promise<Reply> {
    const headers: Record<string, string> = { origin: BASE_URL };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(BASE_URL + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        });
      } catch (err) {
        throw new Error(`${method} ${BASE_URL}${path} failed: is the server running? (${(err as Error).message})`);
      }
      // In production Better Auth allows 3 sign-ins/sign-ups per 10 s per IP, and every scenario signs
      // in from the same address: wait as long as it says (X-Retry-After) and try again.
      if (res.status !== 429 || attempt > MAX_RATE_LIMIT_RETRIES) break;
      const seconds = Number(res.headers.get("x-retry-after")) || 10;
      await res.body?.cancel();
      await sleep((seconds + 0.5) * 1000);
    }
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (!value || /max-age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. HTML): keep the text
    }
    return { status: res.status, body: parsed };
  }

  get(path: string) {
    return this.call("GET", path);
  }
  post(path: string, body: unknown = {}) {
    return this.call("POST", path, body);
  }
  put(path: string, body: unknown) {
    return this.call("PUT", path, body);
  }
  patch(path: string, body: unknown) {
    return this.call("PATCH", path, body);
  }

  /** Better Auth sign-up (signs in too). Users only choose login + password; email/name are filled in. */
  async signUp(username: string): Promise<this> {
    const r = await this.post("/api/auth/sign-up/email", {
      email: `${username.toLowerCase()}@users.invalid`,
      name: username,
      username,
      password: PASSWORD,
    });
    expectStatus(r, 200, `${this.label}: sign up ${username}`);
    this.username = username.toLowerCase();
    return this;
  }

  async signIn(username: string, password = PASSWORD): Promise<this> {
    const r = await this.post("/api/auth/sign-in/username", { username, password });
    expectStatus(r, 200, `${this.label}: sign in ${username}`);
    this.username = username.toLowerCase();
    return this;
  }
}

const show = (body: unknown) => JSON.stringify(body)?.slice(0, 600);

export function expectStatus(reply: Reply, status: number, what: string): void {
  assert.equal(reply.status, status, `${what}: expected HTTP ${status}, got ${reply.status}: ${show(reply.body)}`);
}

/** Expects the status and parses the body with the contract schema. */
export function ok<S extends z.ZodType>(reply: Reply, status: number, schema: S, what: string): z.infer<S> {
  expectStatus(reply, status, what);
  const parsed = schema.safeParse(reply.body);
  assert.ok(parsed.success, `${what}: response doesn't match the contract: ${parsed.error?.message}\n${show(reply.body)}`);
  return parsed.data;
}

/** Expects an error status and, when given, the error `code`. */
export function expectError(reply: Reply, status: number, code: string | null, what: string): void {
  expectStatus(reply, status, what);
  if (code) assert.equal((reply.body as { code?: string } | null)?.code, code, `${what}: error code (${show(reply.body)})`);
}
