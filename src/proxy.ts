import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Pages are public: guests browse, and the frontend opens a sign-in panel when they do something
// that needs an account (src/features/auth/auth-panel.tsx). The data stays protected by the API,
// which checks the session on every request (default-deny, src/server/api/app.ts). This guard only
// sends signed-in users away from the sign-in pages (cookie check, no database call).
const AUTH_PAGES = new Set(["/login", "/signup"]);

export function proxy(request: NextRequest) {
  // Frontend work on mocks needs no backend and no login.
  if (process.env.NEXT_PUBLIC_USE_MOCKS === "true") return NextResponse.next();

  const { pathname } = request.nextUrl;
  const signedIn = Boolean(getSessionCookie(request));
  const isAuthPage = AUTH_PAGES.has(pathname);
  // Behind the reverse proxy the request URL may say http; BETTER_AUTH_URL is the public origin.
  const base = process.env.BETTER_AUTH_URL ?? request.url;

  if (signedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", base));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the API, Next internals and files with an extension (favicon, images, …).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
