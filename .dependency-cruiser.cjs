/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make code hard to follow and refactor.",
      from: {},
      to: { circular: true },
    },
    {
      name: "types-no-runtime-imports",
      severity: "error",
      comment: "Types should only use type-only imports, not runtime imports.",
      from: { path: "^src/.*/types\\.ts$" },
      to: {
        path: "^src/(?!.*types\\.ts$)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules that are not imported by anything may be dead code.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(cjs|mjs|js|ts)$", // dot files
          "\\.test\\.ts$", // test files
          "^src/index(-lite)?\\.ts$", // main entry points
          "^src/loader(-lite)?\\.ts$", // loaders
          "^bin/", // CLI entry points
          "^lib/", // CDK constructs
          "^scripts/", // utility scripts
        ],
      },
      to: {},
    },
    {
      name: "no-dev-deps-in-src",
      severity: "error",
      comment: "Production code should not import devDependencies.",
      from: { path: "^src/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"], pathNot: "^node_modules/@types/" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "./tsconfig.json" },
    exclude: {
      path: ["dist", "cdk.out", "coverage", "public"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
