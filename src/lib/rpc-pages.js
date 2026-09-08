// Use a stable unique ordering so the API row limit never hides roster members.
// Supabase/PostgREST defaults to a 1,000-row response ceiling, so use that full page
// and avoid doubling network round trips for conference-sized rosters.
export async function loadRpcPages(client, name, args, orderColumns, pageSize = 1000) {
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
