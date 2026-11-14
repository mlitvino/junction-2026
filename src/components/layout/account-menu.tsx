import { Popover } from "@/components/ui/popover";
import type { ShellViewer } from "./navigation";

export function AccountMenu({ viewer }: { viewer?: ShellViewer }) {
  return (
    <Popover label="Open account menu" icon="user" title="Your account">
      {viewer ? (
        <>
          <p className="break-words font-medium">{viewer.displayName}</p>
          {viewer.organizationLabel && (
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {viewer.organizationLabel}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-medium">Account not connected</p>
          <p className="mt-2 text-sm text-muted-foreground">
            You’re viewing the frontend preview. Sign-in and account controls are coming in a later
            milestone.
          </p>
        </>
      )}
    </Popover>
  );
}
