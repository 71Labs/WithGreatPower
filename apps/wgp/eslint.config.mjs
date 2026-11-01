import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Every icon comes from Hugeicons through one module.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "lucide-react", message: "Use Hugeicons via @/components/icons." }],
          patterns: [
            { group: ["@hugeicons/*"], message: "Import icons from @/components/icons, which wraps Hugeicons." },
          ],
        },
      ],
    },
  },
  { files: ["src/components/icons.tsx"], rules: { "no-restricted-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
