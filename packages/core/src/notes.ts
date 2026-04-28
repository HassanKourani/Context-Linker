export const ROLES = [
  "ticket",
  "constraint",
  "design",
  "decision",
  "bug",
  "qa",
  "note",
] as const;

export type Role = typeof ROLES[number];

export const ROLE_PRIORITY: Record<Role, number> = {
  ticket: 1,
  constraint: 2,
  design: 3,
  decision: 4,
  bug: 5,
  qa: 6,
  note: 99,
};

export function rolePriority(role: Role | null | undefined): number {
  if (!role) return ROLE_PRIORITY.note;
  return ROLE_PRIORITY[role] ?? ROLE_PRIORITY.note;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
