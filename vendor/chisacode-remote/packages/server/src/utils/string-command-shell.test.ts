import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildStringCommandShellInvocation } from "./string-command-shell.js";

const execFileAsync = promisify(execFile);

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

describe("buildStringCommandShellInvocation", () => {
  it("uses bash login-command semantics on unix platforms", () => {
    expect(
      buildStringCommandShellInvocation({
        command: 'echo "hello"',
        platform: "darwin",
      }),
    ).toEqual({
      shell: "/bin/bash",
      args: ["-lc", 'echo "hello"'],
    });
  });

  it("uses powershell command semantics on windows", () => {
    expect(
      buildStringCommandShellInvocation({
        command: "Write-Output 'hello'",
        platform: "win32",
      }),
    ).toEqual({
      shell: "powershell",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$global:LASTEXITCODE = $null; & { Write-Output 'hello' }; if ($global:LASTEXITCODE -ne $null) { exit $global:LASTEXITCODE }",
      ],
    });
  });

  it.skipIf(process.platform !== "win32")(
    "preserves native command exit codes on windows",
    async () => {
      const invocation = buildStringCommandShellInvocation({
        command: `& ${quotePowerShellLiteral(process.execPath)} -e "process.exit(7)"`,
        platform: "win32",
      });

      await expect(execFileAsync(invocation.shell, invocation.args)).rejects.toMatchObject({
        code: 7,
      });
    },
  );
});
