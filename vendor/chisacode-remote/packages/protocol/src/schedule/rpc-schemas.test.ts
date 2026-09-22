import { describe, expect, test } from "vitest";
import { ScheduleDeleteRequestSchema } from "./rpc-schemas.js";

describe("schedule RPC schemas", () => {
  test.each(["../config", "..\\config", "a/b", "a\\b", "", "a".repeat(129)])(
    "rejects unsafe schedule id %j",
    (scheduleId) => {
      expect(
        ScheduleDeleteRequestSchema.safeParse({
          type: "schedule/delete",
          requestId: "req_1",
          scheduleId,
        }).success,
      ).toBe(false);
    },
  );
});
