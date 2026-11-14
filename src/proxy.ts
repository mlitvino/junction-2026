import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Page guard. Only checks that a session cookie exists (no database call): the API checks the
// session for real on every request (src/server/api/middleware/session.ts).
const AUTH_PAGES = new Set(["/login", "/signup"]);

export function proxy(request: NextRequest) {
  // Frontend work on mocks needs no backend and no login.
  if (process.env.NEXT_PUBLIC_USE_MOCKS === "true") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(getSessionCookie(request));
  const isAuthPage = AUTH_PAGES.has(pathname);
  // Behind the reverse proxy the request URL may say http; BETTER_AUTH_URL is the public origin.
  const base = process.env.BETTER_AUTH_URL ?? request.url;

  if (!signedIn && !isAuthPage) {
    const login = new URL("/login", base);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  if (signedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", base));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the API, Next internals and files with an extension (favicon, images, …).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
