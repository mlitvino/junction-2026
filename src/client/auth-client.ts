import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Better Auth client. Talks to /api/auth/* on the same origin.
export const authClient = createAuthClient({ plugins: [usernameClient()] });

export const useSession = authClient.useSession;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function signIn(login: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.username({ username: login, password });
  if (error) throw new AuthError(error.message ?? "Sign-in failed");
}

export async function signUp(login: string, password: string): Promise<void> {
  const { error } = await authClient.signUp.email({
    // Better Auth requires an email and a name; users only see login + password.
    email: `${login.toLowerCase()}@users.invalid`,
    name: login,
    username: login,
    password,
  });
  if (error) throw new AuthError(error.message ?? "Sign-up failed");
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
