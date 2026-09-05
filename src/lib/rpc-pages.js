// Use a stable unique ordering so the API row limit never hides roster members.
export async function loadRpcPages(client, name, args, orderColumns, pageSize = 500) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let request = client.rpc(name, args);
    for (const column of orderColumns) request = request.order(column, { ascending: true });
    const { data, error } = await request.range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
