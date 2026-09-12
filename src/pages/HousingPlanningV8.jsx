import { useEffect, useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { ArrowsClockwise } from "@phosphor-icons/react/ArrowsClockwise";
import { Users } from "@phosphor-icons/react/Users";
import { ConfirmActionSheet, Empty, MutationFeedback } from "../components/UI.jsx";
import {
  applyHousingCompanyPlanV8,
  clearHousingCompanyPlanV8,
  loadHousingRoomsV8,
  previewHousingCompanyPlanV8,
  subscribeToHousingInventoryV8,
} from "../lib/housing-inventory-v8.js";

const SCENARIOS = [50, 60, 70, 80, 90, 100];

function labelSex(value) {
  return value === "male" ? "Young Men" : "Young Women";
}

function blockLocation(block) {
  const rooms = block.rooms || [];
  if (!rooms.length) return "No rooms available";
  const first = rooms[0];
  const last = rooms[rooms.length - 1];
  const location = [first.hall, first.area, first.floor].filter(Boolean).join(" · ");
  const roomRange = rooms.length === 1 ? first.name : `${first.name} → ${last.name}`;
  return [location, roomRange].filter(Boolean).join(" · ");
}

export function HousingPlanningV8({ sessionId, canManage }) {
  const [scenario, setScenario] = useState(100);
  const [plan, setPlan] = useState(null);
  const [appliedPct, setAppliedPct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [show, setShow] = useState("all");

  const load = async (pct = scenario) => {
    setLoading(true);
    setError("");
    try {
      const [nextPlan, rooms] = await Promise.all([
        previewHousingCompanyPlanV8(sessionId, pct),
        loadHousingRoomsV8(sessionId),
      ]);
      setPlan(nextPlan);
      const planned = rooms.find((room) => room.planKind === "company" && room.planAttendancePct);
      setAppliedPct(planned?.planAttendancePct || null);
    } catch (err) {
      setError(err.message || "Unable to calculate the Housing plan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (sessionId) load(scenario); }, [sessionId, scenario]);
  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeToHousingInventoryV8(sessionId, () => load(scenario).catch(() => {}));
  }, [sessionId, scenario]);

  const summary = plan?.summary || {};
  const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
  const shortages = blocks.filter((block) => Number(block.shortage || 0) > 0);
  const visibleBlocks = show === "shortage" ? shortages : blocks;
  const fit = Number(summary.shortage || 0) === 0;
  const assignmentsStarted = Number(summary.assignments_started || 0);
  const staffTotal = Number(summary.staff_spaces_total || 0);
  const unknownStaff = Number(summary.unknown_staff_spaces || 0);

  const unusedStandard = useMemo(() => Math.max(0, Number(summary.standard_capacity || 0) - blocks.reduce((sum, block) => sum + Number(block.allocated_capacity || 0), 0)), [summary.standard_capacity, blocks]);

  const apply = async () => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await applyHousingCompanyPlanV8(sessionId, scenario);
      setAppliedPct(scenario);
      setPlan(result);
      setSaved(`Youth company room blocks saved for the ${scenario}% attendance scenario. No person has been assigned to a room yet.`);
      setConfirmApply(false);
    } catch (err) {
      setError(err.message || "The Housing plan could not be applied.");
      setConfirmApply(false);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError("");
    try {
      await clearHousingCompanyPlanV8(sessionId);
      setAppliedPct(null);
      setSaved("Youth company room blocks cleared. Individual room assignments were not changed.");
      await load(scenario);
    } catch (err) {
      setError(err.message || "The company plan could not be cleared.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="housing-v8-planning">
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

    <article className="panel housing-v8-scenario">
      <div className="housing-v8-card-head"><div><span className="kicker">Youth attendance scenario</span><h2>Plan youth room blocks before arrivals</h2><p>Each Company × Sex block uses nearby standard rooms for youth only. Counselors, assistant coordinators and other staff sleep separately and are counted below as a separate housing need.</p></div><ArrowsClockwise size={25}/></div>
      <div className="housing-v8-scenario-buttons" role="radiogroup" aria-label="Projected youth attendance">
        {SCENARIOS.map((pct) => <button key={pct} type="button" role="radio" aria-checked={scenario === pct} className={scenario === pct ? "active" : ""} onClick={() => setScenario(pct)}>{pct}%<small>attendance</small></button>)}
      </div>
      {appliedPct ? <div className="housing-v8-current-plan"><CheckCircle/><span><b>Saved youth plan: {appliedPct}% attendance</b><small>Live participant room suggestions now prefer their saved company blocks. Staff do not use those blocks.</small></span></div> : <div className="housing-v8-current-plan neutral"><Bed/><span><b>No youth company block plan saved yet</b><small>Scenario calculations are read-only until you choose Apply plan.</small></span></div>}
    </article>

    <div className="housing-v8-plan-kpis" aria-busy={loading}>
      <span><b>{loading ? "—" : Number(summary.standard_capacity || 0).toLocaleString()}</b><small>standard youth-capable spaces</small></span>
      <span><b>{loading ? "—" : Number(summary.target_spaces || 0).toLocaleString()}</b><small>youth spaces needed at {scenario}%</small></span>
      <span className={Number(summary.shortage || 0) ? "attention" : "good"}><b>{loading ? "—" : Number(summary.shortage || 0).toLocaleString()}</b><small>{Number(summary.shortage || 0) ? "youth space shortage" : "youth shortage"}</small></span>
      <span><b>{loading ? "—" : Number(summary.flex_capacity || 0).toLocaleString()}</b><small>flexible special spaces</small></span>
    </div>

    {!loading ? <div className="housing-v8-sex-fit">
      <article className={Number(summary.male_target || 0) > Number(summary.male_capacity || 0) ? "short" : "fit"}><span>Young Men</span><b>{Number(summary.male_capacity || 0).toLocaleString()} capacity</b><small>{Number(summary.male_target || 0).toLocaleString()} youth needed · {Math.max(0, Number(summary.male_target || 0) - Number(summary.male_capacity || 0)).toLocaleString()} short</small></article>
      <article className={Number(summary.female_target || 0) > Number(summary.female_capacity || 0) ? "short" : "fit"}><span>Young Women</span><b>{Number(summary.female_capacity || 0).toLocaleString()} capacity</b><small>{Number(summary.female_target || 0).toLocaleString()} youth needed · {Math.max(0, Number(summary.female_target || 0) - Number(summary.female_capacity || 0)).toLocaleString()} short</small></article>
    </div> : null}

    {!loading ? <div className="housing-v8-staff-separation" role="note"><Users/><span><b>Staff housing is separate · {staffTotal.toLocaleString()} current staff beds to plan</b><small>{Number(summary.male_staff_spaces || 0).toLocaleString()} male · {Number(summary.female_staff_spaces || 0).toLocaleString()} female{unknownStaff ? ` · ${unknownStaff.toLocaleString()} still need sex recorded` : ""}. These beds are not included in the youth company blocks.</small></span></div> : null}

    {!loading && !fit ? <div className="housing-v8-plan-warning"><WarningCircle/><span><b>This youth scenario does not fit the standard-room inventory yet.</b><small>The plan uses every compatible standard room it can and leaves the short blocks visible. Capacity here only reflects inventory loaded in the app. Add Unity and any missing SRC room details, or deliberately reclassify flexible spaces, before treating this as the full session housing picture.</small></span></div> : null}

    <article className="panel housing-v8-blocks-panel">
      <div className="housing-v8-list-head"><div><span className="kicker">Youth company blocks</span><h2>{loading ? "Calculating…" : `${blocks.length} Company × Sex blocks`}</h2><p>Rooms are consumed in physical inventory order so youth in the same company stay nearby. Staff rooms remain outside these blocks.</p></div><div className="housing-v8-plan-filter"><button type="button" className={show === "all" ? "active" : ""} onClick={() => setShow("all")}>All</button><button type="button" className={show === "shortage" ? "active" : ""} onClick={() => setShow("shortage")}>Needs rooms · {shortages.length}</button></div></div>

      <div className="housing-v8-block-list">
        {visibleBlocks.map((block) => <article key={`${block.company_id}:${block.sex}`} className={`housing-v8-block-card${Number(block.shortage || 0) ? " shortage" : ""}`}>
          <div><span className="kicker">{block.company_name} · {labelSex(block.sex)}</span><h3>{Number(block.allocated_rooms || 0)} room{Number(block.allocated_rooms || 0) === 1 ? "" : "s"} · {Number(block.allocated_capacity || 0)} spaces</h3><p>{blockLocation(block)}</p></div>
          <div className="housing-v8-block-math youth-only"><span><b>{block.projected_participants}</b><small>projected youth</small></span><span><b>{block.target_spaces}</b><small>youth target</small></span>{Number(block.shortage || 0) ? <span className="bad"><b>{block.shortage}</b><small>short</small></span> : <span className="good"><b>Ready</b><small>{Math.max(0, Number(block.allocated_capacity || 0) - Number(block.target_spaces || 0))} spare</small></span>}</div>
        </article>)}
        {!loading && !visibleBlocks.length ? <Empty icon={CheckCircle} title={show === "shortage" ? "No youth blocks are short in this scenario" : "No youth company blocks available"} text={show === "shortage" ? "All Company × Sex youth targets fit the current standard-room inventory." : "Import usable standard rooms first."}/> : null}
      </div>

      <footer className="housing-v8-plan-actions">
        <span><b>{unusedStandard.toLocaleString()} standard spaces remain outside the generated youth blocks</b><small>They are not automatically staff rooms. Review staff needs and room use separately.</small></span>
        <div>{appliedPct && assignmentsStarted === 0 ? <button type="button" className="secondary" disabled={!canManage || busy} onClick={clear}>Clear saved plan</button> : null}<button type="button" className="primary" disabled={!canManage || busy || loading || assignmentsStarted > 0 || !blocks.length} onClick={() => setConfirmApply(true)}>{busy ? "Saving…" : appliedPct === scenario ? "Rebuild this youth plan" : `Apply ${scenario}% youth plan`}</button></div>
      </footer>
      {assignmentsStarted > 0 ? <div className="housing-v8-inline-warning"><WarningCircle/><span><b>Automatic re-planning is locked because live room assignments have started.</b><small>This protects people who may already have keys or luggage in a room. Individual room changes still use the audited Housing move flow.</small></span></div> : null}
    </article>

    {confirmApply ? <ConfirmActionSheet open title={`Apply the ${scenario}% youth Housing plan?`} description="This saves youth Company × Sex room blocks across the current compatible standard-room inventory. Staff housing stays separate, and no person is assigned to a room by this action." impact={Number(summary.shortage || 0) ? `The youth scenario is still short by ${Number(summary.shortage || 0).toLocaleString()} spaces. Available rooms will be planned now and the shortage will remain visible. Staff still need separate housing.` : `The current standard-room inventory can cover this youth scenario. ${staffTotal.toLocaleString()} current staff still need separate sleeping spaces.`} confirmLabel={`Apply ${scenario}% youth plan`} cancelLabel="Keep current plan" busy={busy} onClose={() => setConfirmApply(false)} onConfirm={apply}/> : null}
  </div>;
}
