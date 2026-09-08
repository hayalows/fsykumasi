import { searchPeople } from "./person-search.js";
const mealSearchCache=new Map();
import { loadRpcPages } from "./rpc-pages.js";
import { dietaryNeedsReview } from "./dietary.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadMealServicesV2(sessionId, serviceDate = null) {
  const { data, error } = await client().rpc("get_meal_services_v2", {
    p_session_id: sessionId,
    p_service_date: serviceDate || null,
  });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.service_id,
    date: row.service_date,
    mealType: row.meal_type,
    label: row.label || row.meal_type,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    servedCount: Number(row.served_count || 0),
    expectedCount: Number(row.expected_count || 0),
  }));
}

export async function loadMealRosterPageV2({
  serviceId,
  query = "",
  companyId = "",
  status = "remaining",
  limit = 80,
  offset = 0,
  identities = [],
}) {
  if(query.trim()) {
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
  const { data, error } = await client().rpc("get_meal_roster_page_v2", {
    p_meal_service_id: serviceId,
    p_query: query.trim() || null,
    p_company_id: companyId || null,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const rows = (data || []).map((row) => ({
    personId: row.participant_id,
    name: row.display_name,
    fsyId: row.fsy_id || "",
    companyId: row.company_id || "",
    company: row.company_name || "Unassigned",
    group: row.group_name || "",
    servedAt: row.served_at || null,
  }));
  return {
    rows,
    total: Number(data?.[0]?.total_count || 0),
  };
}

export async function loadMealProgressV2(serviceId) {
  const { data, error } = await client().rpc("get_meal_progress_v2", { p_meal_service_id: serviceId });
  if (error) throw error;
  return (data || []).map((row) => ({
    companyId: row.company_id || "",
    company: row.company_name || "Unassigned",
    expectedCount: Number(row.expected_count || 0),
    servedCount: Number(row.served_count || 0),
  }));
}

export async function loadFoodNeedsV2(sessionId) {
  const data = await loadRpcPages(client(), "get_food_needs_v2", { p_session_id: sessionId }, ["person_type", "person_id"], 500);
  return (data || [])
    .filter((row) => dietaryNeedsReview(row.dietary_information))
    .map((row) => ({
      personType: row.person_type,
      personId: row.person_id,
      name: row.display_name,
      dietaryInformation: row.dietary_information || "",
      group: row.group_name || "",
      company: row.company_name || "",
      acknowledged: Boolean(row.acknowledged),
      acknowledgedAt: row.acknowledged_at,
    }));
}

export async function setParticipantMealServedV2({ serviceId, participantId, served }) {
  const { data, error } = await client().rpc("set_participant_meal_served_v2", {
    p_meal_service_id: serviceId,
    p_participant_id: participantId,
    p_served: Boolean(served),
  });
  if (error) throw error;
  mealSearchCache.clear();
  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: row?.attendance_id || null,
    servedAt: row?.served_at || null,
    served: Boolean(row?.served),
  };
}