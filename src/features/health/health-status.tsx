"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/client/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthResponse } from "@/shared/contracts/health";

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    apiClient
      .getHealth()
      .then((data) => setState({ kind: "ok", data }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>API health</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {state.kind === "loading" && <p className="text-muted-foreground">Checking…</p>}
        {state.kind === "ok" && (
          <p>
            Status: <span className="font-medium text-green-600">{state.data.status}</span>
            <br />
            <span className="text-muted-foreground">{state.data.time}</span>
          </p>
        )}
        {state.kind === "error" && <p className="text-destructive">Error: {state.message}</p>}
      </CardContent>
    </Card>
  );
}
