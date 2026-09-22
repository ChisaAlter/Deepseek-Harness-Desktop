import net from "node:net";

function parseArgs(argv) {
  let socketPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--socket") {
      socketPath = argv[index + 1] ?? null;
      index += 1;
    }
  }

  if (!socketPath || !socketPath.trim()) {
    throw new Error("Missing required --socket <path>");
  }

  return { socketPath: socketPath.trim() };
}

async function main() {
  const { socketPath } = parseArgs(process.argv.slice(2));
  const socket = net.createConnection(socketPath);

  socket.on("error", (error) => {
    process.stderr.write(`MCP stdio-socket bridge error: ${error.message}\n`);
    process.exitCode = 1;
  });

  process.stdin.on("error", (error) => {
    process.stderr.write(`MCP stdio-socket bridge stdin error: ${error.message}\n`);
    socket.destroy();
    process.exitCode = 1;
  });

  process.stdout.on("error", (error) => {
    process.stderr.write(`MCP stdio-socket bridge stdout error: ${error.message}\n`);
    socket.destroy();
    process.exitCode = 1;
  });

  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  process.stdin.pipe(socket);
  socket.pipe(process.stdout);

  await new Promise((resolve) => {
    socket.once("close", resolve);
    process.stdin.once("end", () => {
      socket.end();
      resolve();
    });
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
