/**
 * Test helper: creates a mock Supabase client with chainable query builder.
 *
 * Usage:
 *   const { client, mockTable } = createMockSupabase();
 *   mockTable("bundles").select.mockReturnValue({ data: [...], error: null });
 */

type MockResult = { data: any; error: any };

interface MockQueryBuilder {
  select: ReturnType<typeof import("bun:test").mock>;
  insert: ReturnType<typeof import("bun:test").mock>;
  update: ReturnType<typeof import("bun:test").mock>;
  upsert: ReturnType<typeof import("bun:test").mock>;
  delete: ReturnType<typeof import("bun:test").mock>;
  eq: ReturnType<typeof import("bun:test").mock>;
  neq: ReturnType<typeof import("bun:test").mock>;
  in: ReturnType<typeof import("bun:test").mock>;
  is: ReturnType<typeof import("bun:test").mock>;
  not: ReturnType<typeof import("bun:test").mock>;
  order: ReturnType<typeof import("bun:test").mock>;
  limit: ReturnType<typeof import("bun:test").mock>;
  single: ReturnType<typeof import("bun:test").mock>;
  maybeSingle: ReturnType<typeof import("bun:test").mock>;
  // The terminal result — what the chain resolves to
  _result: MockResult;
}

export function createMockQueryBuilder(): MockQueryBuilder {
  const result: MockResult = { data: null, error: null };

  const builder: any = {};

  // All chainable methods return `builder` so calls like .select().eq().order() work
  const chainMethods = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "in", "is", "not", "order", "limit",
  ];

  for (const method of chainMethods) {
    builder[method] = (..._args: any[]) => builder;
  }

  // Terminal methods return the result
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);

  // Make the builder itself thenable (for `await sb.from("x").select()...`)
  builder.then = (resolve: any, reject: any) => {
    return Promise.resolve(result).then(resolve, reject);
  };

  builder._result = result;

  return builder;
}

export function createMockSupabase() {
  const tables = new Map<string, MockQueryBuilder>();

  function getTable(name: string): MockQueryBuilder {
    if (!tables.has(name)) {
      tables.set(name, createMockQueryBuilder());
    }
    return tables.get(name)!;
  }

  const client = {
    from: (table: string) => getTable(table),
  };

  return {
    client: client as any,
    /** Get or create a mock table to configure its return values */
    mockTable: (name: string) => getTable(name),
    /** Set the data that a table query will return */
    setTableData: (name: string, data: any, error: any = null) => {
      const table = getTable(name);
      table._result.data = data;
      table._result.error = error;
    },
  };
}
