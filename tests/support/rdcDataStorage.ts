// An in-memory stand-in for the page's `DataStorage`: find, insert_one (a duplicate `_id` fails
// as the service does, with an HTTP 400), replace_one (with upsert, answering `matched_count`)
// and delete_many. A filter matches by equality, or by `$exists` / `$regex` on a key.
export function memoryDataStorage(initial: Record<string, unknown>[] = []) {
  const docs: Record<string, unknown>[] = initial.map((d) => ({ ...d }));
  const one = (have: unknown, want: any) => {
    if (want && typeof want === 'object' && !Array.isArray(want)) {
      if ('$exists' in want) return (have !== undefined) === want.$exists;
      if ('$regex' in want) return typeof have === 'string' && new RegExp(want.$regex).test(have);
    }
    return have === want;
  };
  const matches = (d: Record<string, unknown>, q: Record<string, unknown> = {}) =>
    Object.entries(q).every(([k, v]) => one(d[k], v));
  const calls: [string, any][] = [];
  // set to make the next write of that op fail, as a broken service would
  const failNext: Record<string, string> = {};
  // set to apply the next write of that op and then lose its answer, as a dropped connection does
  const loseAnswer: Record<string, string> = {};
  const ds = async (op: string, body: Record<string, any>): Promise<unknown> => {
    if (loseAnswer[op]) {
      const m = loseAnswer[op];
      delete loseAnswer[op];
      await apply(op, body);
      throw new Error(m);
    }
    return apply(op, body);
  };
  const apply = async (op: string, body: Record<string, any>): Promise<unknown> => {
    calls.push([op, body]);
    if (failNext[op]) {
      const m = failNext[op];
      delete failNext[op];
      throw new Error(m);
    }
    if (op === 'find') return docs.filter((d) => matches(d, body.query)).slice(0, body.limit);
    if (op === 'insert_one') {
      if (docs.some((d) => d._id === body.document._id)) throw new Error('HTTP 400');
      docs.push({ ...body.document });
      return { inserted_id: body.document._id };
    }
    if (op === 'replace_one') {
      const i = docs.findIndex((d) => matches(d, body.filter));
      if (i >= 0)
        docs[i] = { ...body.replacement, ...('_id' in docs[i] ? { _id: docs[i]._id } : {}) };
      else if (body.options?.upsert) docs.push({ ...body.replacement });
      return { matched_count: i >= 0 ? 1 : 0, modified_count: i >= 0 ? 1 : 0 };
    }
    if (op === 'delete_many') {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--)
        if (matches(docs[i], body.filter)) docs.splice(i, 1);
      return { deleted_count: before - docs.length };
    }
    throw new Error(`unexpected op ${op}`);
  };
  return { ds, docs, calls, failNext, loseAnswer };
}
