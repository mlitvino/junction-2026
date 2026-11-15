import "server-only";

import { and, desc, eq, gte, inArray, sum } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { purchaseOrder, valioProduct } from "@/server/db/schema";
import { governanceReasons, type GovernanceLine } from "@/server/policy/governance";
import { getEffectiveFor } from "./preferences";

type Reader = Pick<ReturnType<typeof getDb>, "select">;

export async function checkPurchasingGovernance(
  d: Reader,
  organizationId: string,
  lines: Pick<GovernanceLine, "productId" | "unitPriceExclVat" | "substituteFor">[],
  total: number | null,
) {
  const [effective, [spending], history, products] = await Promise.all([
    getEffectiveFor(organizationId, "buyer", d),
    d
      .select({ total: sum(purchaseOrder.totalExclVat) })
      .from(purchaseOrder)
      .where(
        and(
          eq(purchaseOrder.organizationId, organizationId),
          gte(purchaseOrder.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      ),
    d
      .select({ lines: purchaseOrder.lines })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.organizationId, organizationId))
      .orderBy(desc(purchaseOrder.createdAt))
      .limit(200),
    d
      .select({
        productId: valioProduct.id,
        brand: valioProduct.brand,
        vendorName: valioProduct.vendorName,
      })
      .from(valioProduct)
      .where(
        inArray(
          valioProduct.id,
          lines.map((l) => l.productId),
        ),
      ),
  ]);
  return governanceReasons(
    effective.values,
    lines.map((line) => ({
      ...line,
      vendorName: "",
      ...products.find((p) => p.productId === line.productId),
    })),
    total,
    Number(spending?.total ?? 0),
    history.flatMap((order) => order.lines),
  );
}
