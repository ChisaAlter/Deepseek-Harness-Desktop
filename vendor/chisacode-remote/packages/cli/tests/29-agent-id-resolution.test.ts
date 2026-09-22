#!/usr/bin/env npx tsx

import assert from "node:assert";
import { resolveAgentId } from "../src/utils/client.js";

console.log("=== Agent ID Resolution Tests ===\n");

const agents = [
  { id: "abc1234-full-agent-id", title: "Build docs" },
  { id: "def5678-other-agent-id", title: "Fix archive flow" },
  { id: "987zyxw-third-agent-id", title: "Review PR" },
];

{
  console.log("Test 1: exact ID match resolves");
  assert.strictEqual(resolveAgentId("abc1234-full-agent-id", agents), "abc1234-full-agent-id");
  console.log("✓ exact ID match resolves\n");
}

{
  console.log("Test 2: ID prefix resolves");
  assert.strictEqual(resolveAgentId("def5678", agents), "def5678-other-agent-id");
  console.log("✓ ID prefix resolves\n");
}

{
  console.log("Test 3: exact name match resolves case-insensitively");
  assert.strictEqual(resolveAgentId("fix archive flow", agents), "def5678-other-agent-id");
  console.log("✓ exact name match resolves case-insensitively\n");
}

{
  console.log("Test 4: partial name match resolves when unique");
  assert.strictEqual(resolveAgentId("review", agents), "987zyxw-third-agent-id");
  console.log("✓ partial name match resolves when unique\n");
}

{
  console.log("Test 5: missing agent returns null");
  assert.strictEqual(resolveAgentId("does not exist", agents), null);
  console.log("✓ missing agent returns null\n");
}

console.log("=== All agent ID resolution tests passed ===");
