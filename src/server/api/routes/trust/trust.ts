import "server-only";

import { publicKeyInfo } from "@/server/services/trust";

import { createRouter } from "../../router";
import { getPublicKeyRoute } from "./trust.docs";

export const trustRouter = createRouter().openapi(getPublicKeyRoute, (c) => c.json(publicKeyInfo(), 200));
