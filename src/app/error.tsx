"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-8 py-24">
      <h1 className="page-title">Something interrupted this page</h1>
      <p className="my-5 text-muted-foreground">
        Your purchasing records are not changed by reloading this view.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
