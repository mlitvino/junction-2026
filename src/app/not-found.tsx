import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-8 py-24">
      <h1 className="page-title">Page not found</h1>
      <p className="mt-4 text-muted-foreground">
        This page is unavailable or the reference is no longer valid.
      </p>
      <Link href="/buyer" className="mt-6 inline-block min-h-11 py-3 text-primary underline">
        Return to Assistant
      </Link>
    </main>
  );
}
