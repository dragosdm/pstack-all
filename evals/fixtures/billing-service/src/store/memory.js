export function memoryStore() {
  const tables = new Map();
  const counters = new Map();
  return {
    save(table, id, row) {
      if (!tables.has(table)) tables.set(table, new Map());
      tables.get(table).set(id, structuredClone(row));
    },
    get: (table, id) => tables.get(table)?.get(id) ?? null,
    increment(key) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
  };
}
