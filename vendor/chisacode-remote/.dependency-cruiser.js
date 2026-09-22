/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-server-importing-app-or-client",
      comment: "Server packages must not depend on app/client/desktop/cli.",
      severity: "error",
      from: { path: "^packages/server" },
      to: {
        path: "^packages/(app|client|desktop|cli)",
        pathNot: "^packages/client",
      },
    },
    {
      name: "no-cross-handler-imports",
      comment:
        "Session handlers must not import each other directly. Use SessionContext callbacks.",
      severity: "error",
      from: {
        path: "^packages/server/src/server/session-handlers/",
        pathNot: "__tests__|index\\.ts|session-context\\.ts",
      },
      to: {
        path: "^packages/server/src/server/session-handlers/",
        pathNot: "index\\.ts|session-context\\.ts",
      },
    },
    {
      name: "no-protocol-importing-server",
      comment: "protocol must not depend on any other workspace package.",
      severity: "error",
      from: { path: "^packages/protocol" },
      to: { path: "^packages/(?!protocol)", pathNot: "node_modules" },
    },
    {
      name: "no-client-importing-server",
      comment: "client must not depend on server.",
      severity: "error",
      from: { path: "^packages/client" },
      to: { path: "^packages/server" },
    },
    {
      name: "no-relay-importing-server-or-app",
      comment: "relay must not depend on server or app.",
      severity: "error",
      from: { path: "^packages/relay" },
      to: { path: "^packages/(server|app|desktop|cli)" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    exoticRequireStrings: ["requireJSON"],
  },
};
