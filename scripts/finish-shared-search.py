from pathlib import Path
root=Path(__file__).resolve().parents[1]
def edit(path,fn):
 p=root/path;s=p.read_text(encoding='utf-8');p.write_text(fn(s),encoding='utf-8')
edit('src/lib/food-workspace.js',lambda s:'import { searchPeople } from "./person-search.js";\nconst mealSearchCache=new Map();\n'+s.replace('  offset = 0,','  offset = 0,\n  identities = [],').replace('  const { data, error } = await client().rpc("get_meal_roster_page_v2", {','''  if(query.trim()) {
    // Search the entire server-authorized roster, never only a loaded page.
    const key=JSON.stringify([serviceId,companyId,status]);
    let cached=mealSearchCache.get(key);
    if(!cached||Date.now()-cached.at>15000){
      const promise=(async()=>{const all=[];let total=Infinity;
        for(let start=0;start<total;start+=200){const page=await loadMealRosterPageV2({serviceId,companyId,status,limit:200,offset:start});total=page.total;all.push(...page.rows);if(!page.rows.length)break;}return all;})();
      cached={at:Date.now(),promise};mealSearchCache.set(key,cached);promise.catch(()=>mealSearchCache.delete(key));
    }
    const byId=new Map(identities.map(p=>[p.id,p]));
    const rows=searchPeople((await cached.promise).map(row=>({...byId.get(row.personId),...row})),query);
    return {rows:rows.slice(offset,offset+limit),total:rows.length};
  }
  const { data, error } = await client().rpc("get_meal_roster_page_v2", {''').replace('  const row = Array.isArray(data) ? data[0] : data;','  mealSearchCache.clear();\n  const row = Array.isArray(data) ? data[0] : data;'))
edit('src/pages/FoodV3.jsx',lambda s:s.replace('status: mealFilter, limit, offset','status: mealFilter, limit, offset, identities: participants'))
edit('tests/operations-ux-v10.test.mjs',lambda s:s.replace(r'if\(!text\)return\[\]',r'if\(!query\.trim\(\)\)return \[\]'))
edit('supabase/migrations/20260908105118_coherent_operations_v26.sql',lambda s:s.replace("target_sex::text<>to_jsonb(new)->>'sex'","target_sex::text<>(to_jsonb(new)->>'sex')"))
