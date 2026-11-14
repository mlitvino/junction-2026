import { Popover } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";

export function NotificationsPopover() {
  return (
    <Popover label="Open notifications" icon="bell" title="Notifications">
      <Icon name="bell" className="mb-3 text-muted-foreground" />
      <p className="font-medium">Notifications are not connected yet</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Purchasing updates will appear here when this feature is available.
      </p>
    </Popover>
  );
}
