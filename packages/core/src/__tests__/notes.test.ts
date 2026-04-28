import { describe, test, expect } from "bun:test";
import { ROLES, ROLE_PRIORITY, rolePriority, type Role } from "../notes.js";

describe("Role enum + priority", () => {
  test("ROLES contains the seven defined roles", () => {
    expect(ROLES).toEqual(["ticket", "constraint", "design", "decision", "bug", "qa", "note"]);
  });

  test("ROLE_PRIORITY orders roles ticket < constraint < design < decision < bug < qa < note", () => {
    expect(ROLE_PRIORITY.ticket).toBeLessThan(ROLE_PRIORITY.constraint);
    expect(ROLE_PRIORITY.constraint).toBeLessThan(ROLE_PRIORITY.design);
    expect(ROLE_PRIORITY.design).toBeLessThan(ROLE_PRIORITY.decision);
    expect(ROLE_PRIORITY.decision).toBeLessThan(ROLE_PRIORITY.bug);
    expect(ROLE_PRIORITY.bug).toBeLessThan(ROLE_PRIORITY.qa);
    expect(ROLE_PRIORITY.qa).toBeLessThan(ROLE_PRIORITY.note);
  });

  test("rolePriority defaults missing role to note priority", () => {
    expect(rolePriority(undefined)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority(null)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority("ticket" as Role)).toBe(ROLE_PRIORITY.ticket);
  });
});
