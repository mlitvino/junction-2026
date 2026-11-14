"use client";

import { useRouter } from "next/navigation";

import { signOut, useSession } from "@/client/auth-client";

/** "Signed in as …" + sign-out. Renders nothing while loading or when signed out. */
export function UserBar() {
  const router = useRouter();
  const { data } = useSession();
  if (!data) return null;

  async function onSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span>
        Signed in as <strong>{data.user.username ?? data.user.name}</strong>
      </span>
      <button type="button" onClick={onSignOut} className="underline">
        Sign out
      </button>
    </div>
  );
}
