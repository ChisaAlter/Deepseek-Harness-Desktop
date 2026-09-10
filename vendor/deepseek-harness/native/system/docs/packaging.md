# Packaging

The family publishes one ESM entry package plus OS/CPU-selected optional platform packages. All share one version; platform packages publish before the entry.

## Payloads

The entry package exports the Landlock API at `./landlock-run` and the asynchronous lock API at `./flock`, with C sources included for auditability. There is no root export. Platform packages contain no JavaScript.

- Linux: `bin/landlock-run`, `bin/glibc/system.node`, and `bin/musl/system.node`.
- macOS: `bin/system.node`.

`package.json` supplies OS/CPU metadata; `prebuilds.json` supplies tool, binary kind, path, and addon Node-API/libc metadata. CI matrices and release assembly derive from those files. Nested paths remain intact in uploaded artifacts and tarballs.

## Installation and use

Neither entry nor platform packages have installation lifecycle scripts. The entry resolves its matching optional package when a native operation needs it. Optional means that the package manager selects a platform, not that a requested lock can succeed without its binding.

The `./landlock-run` API stays importable without native payloads and reports unavailable enforcement through its probe. The flock entry is also lazy at import; acquisition reports a missing or unloadable addon instead of compiling or granting an unprotected lock.

## Pack verification

Platform tarballs use npm pack to preserve the launcher's executable bit. The entry uses pnpm pack to convert workspace dependency versions. Prepack rejects missing or undeclared payloads, invalid ELF/Mach-O architecture or type, addons without Node-API exports, and launchers without executable permission.

The installed-artifact rehearsal verifies concrete dependency versions and absence of installation hooks, performs an offline npm install from local tarballs, and compares installed bytes with build outputs. It then proves flock contention/close release and probes the installed Landlock launcher; real confinement remains required on enforcing CI kernels.
