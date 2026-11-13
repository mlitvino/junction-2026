import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Zone boundaries (see AGENTS.md → "Boundary rules").
// Each zone has exactly ONE no-restricted-imports block: in flat config a later
// block for the same file would replace (not merge) the rule options.
// Patterns use regex so both "@/..." aliases and relative "../" paths are caught.

const FRONTEND_FORBIDDEN = {
  regex: "^(@/server|(\\.\\./)+server)(/|$)",
  message:
    "Frontend must not import from src/server. Talk to the backend via @/client/api-client (AGENTS.md, rule 1).",
};

const BACKEND_FORBIDDEN = {
  regex: "^(@/(components|features|client)|(\\.\\./)+(components|features|client))(/|$)",
  message:
    "Backend (app/api, server) must not import frontend code (components, features, client) (AGENTS.md, rule 2).",
};

const SHARED_FORBIDDEN = {
  regex: "^(?!zod$|\\.{1,2}/|@/shared/)",
  message: "shared/ may import only zod and other shared/ files (AGENTS.md, rule 3).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  {
    name: "zones/frontend",
    files: [
      "src/app/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
      "src/client/**/*.{ts,tsx}",
    ],
    ignores: ["src/app/api/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [FRONTEND_FORBIDDEN] }],
    },
  },
  {
    name: "zones/backend",
    files: ["src/app/api/**/*.{ts,tsx}", "src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [BACKEND_FORBIDDEN] }],
    },
  },
  {
    name: "zones/shared",
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SHARED_FORBIDDEN] }],
    },
  },
]);

export default eslintConfig;
