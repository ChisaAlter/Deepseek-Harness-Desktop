import { describe, expect, test } from "vitest";

import { buildSSHArgs, type SSHConnectionConfig } from "./ssh-transport.js";

describe("buildSSHArgs", () => {
  const minimal: SSHConnectionConfig = { host: "example.com" };

  test("builds minimal SSH args", () => {
    const args = buildSSHArgs(minimal, { remoteCommand: "echo", remoteArgs: ["hello"] });
    expect(args).toContain("-T");
    expect(args).toContain("example.com");
    expect(args[args.length - 1]).toContain("echo");
  });

  test("includes user@host when user is set", () => {
    const args = buildSSHArgs({ host: "srv", user: "deploy" }, { remoteCommand: "ls" });
    expect(args).toContain("deploy@srv");
  });

  test("includes port when non-default", () => {
    const args = buildSSHArgs({ host: "srv", port: 2222 }, { remoteCommand: "ls" });
    expect(args).toContain("-p");
    expect(args).toContain("2222");
  });

  test("omits port for default 22", () => {
    const args = buildSSHArgs({ host: "srv", port: 22 }, { remoteCommand: "ls" });
    expect(args).not.toContain("-p");
  });

  test("includes identity file", () => {
    const args = buildSSHArgs(
      { host: "srv", identityFile: "~/.ssh/id_ed25519" },
      { remoteCommand: "ls" },
    );
    expect(args).toContain("-i");
    expect(args).toContain("~/.ssh/id_ed25519");
  });

  test("rejects dangerous sshOptions (ProxyCommand, StrictHostKeyChecking, PKCS11Provider)", () => {
    expect(() =>
      buildSSHArgs({ host: "srv", sshOptions: ["ProxyCommand=evil"] }, { remoteCommand: "ls" }),
    ).toThrow(/Forbidden SSH option/);
    expect(() =>
      buildSSHArgs(
        { host: "srv", sshOptions: ["StrictHostKeyChecking=no"] },
        { remoteCommand: "ls" },
      ),
    ).toThrow(/Forbidden SSH option/);
    expect(() =>
      buildSSHArgs(
        { host: "srv", sshOptions: ["PKCS11Provider=/tmp/evil.so"] },
        { remoteCommand: "ls" },
      ),
    ).toThrow(/Forbidden SSH option/);
  });

  test("rejects unknown sshOptions not in the safe allowlist", () => {
    expect(() =>
      buildSSHArgs({ host: "srv", sshOptions: ["LocalCommand=rm -rf /"] }, { remoteCommand: "ls" }),
    ).toThrow(/Forbidden SSH option/);
    expect(() =>
      buildSSHArgs({ host: "srv", sshOptions: ["BogusOption=yes"] }, { remoteCommand: "ls" }),
    ).toThrow(/Unknown SSH option/);
  });

  test("accepts safe allowlisted sshOptions", () => {
    const args = buildSSHArgs(
      { host: "srv", sshOptions: ["Compression=yes"] },
      { remoteCommand: "ls" },
    );
    expect(args).toContain("Compression=yes");
  });

  test("forces hardened host-key verification defaults", () => {
    const args = buildSSHArgs(minimal, { remoteCommand: "ls" });
    expect(args).toContain("StrictHostKeyChecking=accept-new");
    expect(args).toContain("UserKnownHostsFile=~/.ssh/known_hosts");
  });

  test("includes BatchMode and ConnectTimeout", () => {
    const args = buildSSHArgs(minimal, { remoteCommand: "ls" });
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=30");
  });

  test("prepends cd for remoteCwd", () => {
    const args = buildSSHArgs(minimal, {
      remoteCommand: "claude",
      remoteCwd: "/home/user/project",
    });
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain("cd /home/user/project");
    expect(remoteCmd).toContain("claude");
  });

  test("prepends export for remoteEnv", () => {
    const args = buildSSHArgs(minimal, {
      remoteCommand: "agent",
      remoteEnv: { NODE_ENV: "production" },
    });
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain("export NODE_ENV=production");
  });

  test("quotes values with spaces", () => {
    const args = buildSSHArgs(minimal, {
      remoteCommand: "agent",
      remoteCwd: "/home/user/my project",
    });
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain("'/home/user/my project'");
  });

  test("quotes env values with special characters", () => {
    const args = buildSSHArgs(minimal, {
      remoteCommand: "agent",
      remoteEnv: { GREETING: "hello world" },
    });
    const remoteCmd = args[args.length - 1];
    expect(remoteCmd).toContain("'hello world'");
  });

  test("rejects newlines in remoteEnv values", () => {
    expect(() =>
      buildSSHArgs(
        { host: "srv" },
        { remoteCommand: "agent", remoteEnv: { EVIL: "line1\nline2" } },
      ),
    ).toThrow(/newlines/);
  });

  test("quotes remoteCwd starting with - so it is not parsed as an option", () => {
    const args = buildSSHArgs(minimal, { remoteCommand: "cd", remoteCwd: "-rf /" });
    const remoteCmd = args[args.length - 1];
    // The cwd must be single-quoted, not passed bare as `cd -rf /`.
    expect(remoteCmd).toContain("cd '-rf /'");
  });

  test("chains cd + env + command with &&", () => {
    const args = buildSSHArgs(minimal, {
      remoteCommand: "claude",
      remoteArgs: ["--acp"],
      remoteCwd: "/app",
      remoteEnv: { KEY: "val" },
    });
    const remoteCmd = args[args.length - 1];
    // --acp starts with `-` so it is quoted to stay positional; the remote shell
    // strips the quotes and claude still receives `--acp`.
    expect(remoteCmd).toBe("cd /app && export KEY=val && claude '--acp'");
  });
});
