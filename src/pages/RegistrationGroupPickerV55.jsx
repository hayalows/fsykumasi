import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Empty, MutationFeedback } from "../components/UI.jsx";
import { applyOnSiteOverflowPlacement, previewOnSiteOverflowPlacement } from "../lib/onsite.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sexValue(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

function planCopy(plan) {
  if (!plan) return null;
  if (plan.reason === "regular_space_available") {
    return {
      title: plan.regular_group_name || "Available counselor group",
      meta: `${plan.regular_company_name || "Company"} · ${Number(plan.regular_open || 0)} ${Number(plan.regular_open || 0) === 1 ? "place" : "places"} open`,
      note: "A normal group became available. Use it instead of creating extra structure.",
    };
  }
  const staff = [
    plan.counselor_name ? `Counselor · ${plan.counselor_name}${plan.counselor_planning_state ? ` (${plan.counselor_planning_state})` : ""}` : "",
    plan.assistant_name ? `Assistant Coordinator · ${plan.assistant_name}${plan.assistant_planning_state ? ` (${plan.assistant_planning_state})` : ""}` : "",
  ].filter(Boolean).join(" · ");
  return {
    title: plan.group_name || "Supplemental counselor group",
    meta: `${plan.company_name || "Supplemental company"}${staff ? ` · ${staff}` : ""}`,
    note: plan.mode === "new_company"
      ? "This will create one supplemental company and one counselor group, then place the participant and issue the FSY ID."
      : "This will add one counselor group to the existing company, then place the participant and issue the FSY ID.",
  };
}

export function GroupPickerV55({ groups, companies, row, busy, loading = false, error, placementRefreshFailed = false, onRetry, onChoose }) {
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(6);
  const [selectedId, setSelectedId] = useState("");
  const [overflowPlan, setOverflowPlan] = useState(null);
  const [overflowLoading, setOverflowLoading] = useState(false);
  const [overflowBusy, setOverflowBusy] = useState(false);
  const [overflowError, setOverflowError] = useState("");
  const companyById = useMemo(() => new Map(companies.map((item) => [item.id, item])), [companies]);
  const choices = useMemo(() => groups
    .filter((group) => {
      const max = Number(group.maxSize || 10);
      return sexValue(group.sex) === sexValue(row.sex)
        && group.state === "published"
        && group.counselorReady === true
        && Number(group.memberCount || 0) < max;
    })
    .sort((a, b) => Number(a.memberCount || 0) - Number(b.memberCount || 0) || collator.compare(a.name, b.name)), [groups, row.sex]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return choices;
    return choices.filter((group) => {
      const company = companyById.get(group.companyId);
      return `${group.displayName || group.name} ${company?.displayName || company?.name || ""}`.toLowerCase().includes(text);
    });
  }, [choices, companyById, query]);
  const visible = filtered.slice(0, visibleLimit);
  const selected = choices.find((group) => group.id === selectedId) || null;
  const selectedCompany = selected ? companyById.get(selected.companyId) : null;
  const firstName = String(row.fullName || "participant").trim().split(/\s+/)[0] || "participant";
  const plan = planCopy(overflowPlan);
  const isOnSite = row.sourceKind === "on_site";
  const noStandardSpace = !loading && choices.length === 0;
  const noSearchMatch = !loading && choices.length > 0 && visible.length === 0;

  useEffect(() => {
    if (selectedId && !choices.some((group) => group.id === selectedId)) setSelectedId("");
  }, [choices, selectedId]);
  useEffect(() => {
    setQuery("");
    setSelectedId("");
    setVisibleLimit(6);
    setOverflowPlan(null);
    setOverflowError("");
  }, [row.participantId]);

  const reviewOverflow = async () => {
    if (!row.participantId || overflowLoading || overflowBusy) return;
    setOverflowLoading(true);
    setOverflowError("");
    setOverflowPlan(null);
    try {
      const next = await previewOnSiteOverflowPlacement(row.participantId);
      setOverflowPlan(next);
      if (!next?.ready && next?.reason !== "regular_space_available") {
        setOverflowError(next?.message || "Overflow placement is not ready yet. Review the available staff and try again.");
      }
    } catch (err) {
      setOverflowError(err.message || "The overflow option could not be checked.");
    } finally {
      setOverflowLoading(false);
    }
  };

  const usePreview = async () => {
    if (!overflowPlan || overflowBusy) return;
    if (overflowPlan.reason === "regular_space_available" && overflowPlan.regular_group_id) {
      setOverflowError("");
      await onChoose({ id: overflowPlan.regular_group_id, name: overflowPlan.regular_group_name, displayName: overflowPlan.regular_group_name });
      setOverflowPlan(null);
      return;
    }
    if (!overflowPlan.ready) return;
    setOverflowBusy(true);
    setOverflowError("");
    try {
      await applyOnSiteOverflowPlacement({
        participantId: row.participantId,
        counselorId: overflowPlan.counselor_id,
        assistantId: overflowPlan.assistant_id || null,
      });
      setOverflowPlan(null);
      if (onRetry) await onRetry();
    } catch (err) {
      setOverflowError(err.message || "The supplemental group could not be created. Review the plan again before retrying.");
      setOverflowPlan(null);
    } finally {
      setOverflowBusy(false);
    }
  };

  return <div className="regjourney-group-picker regjourney-group-picker-v5">
    <div className="regjourney-placement-guidance"><b>Available groups only</b><span>Lowest load groups are first. A group appears here only when it is published, has a ready counselor and has capacity.</span></div>
    {choices.length > 6 ? <label className="regjourney-inline-search regjourney-inline-search-v5"><span className="sr-only">Find counselor group</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(6); }} placeholder="Search groups or companies" /></label> : null}
    <div className="regjourney-choice-list" role="radiogroup" aria-label="Available counselor groups">
      {visible.map((group, index) => {
        const company = companyById.get(group.companyId);
        const isSelected = group.id === selectedId;
        const max = Number(group.maxSize || 10);
        const openSpots = Math.max(0, max - Number(group.memberCount || 0));
        return <button type="button" key={group.id} className={`regjourney-choice regjourney-choice-v5${isSelected ? " selected" : ""}`} disabled={busy || loading || overflowBusy} onClick={() => { setSelectedId(group.id); setOverflowPlan(null); setOverflowError(""); }} role="radio" aria-checked={isSelected}>
          <span><b>{group.displayName || group.name}</b><small>{company?.displayName || company?.name || "Company"} · {Number(group.memberCount || 0)}/{max} · {openSpots} {openSpots === 1 ? "place" : "places"} open</small></span>
          <span className="regjourney-choice-end">{!query.trim() && index === 0 ? <em>Recommended</em> : null}{isSelected ? <CheckCircle weight="fill" /> : <span className="regjourney-choice-radio" aria-hidden="true" />}</span>
        </button>;
      })}
      {loading ? <Empty icon={UsersThree} title="Checking live group capacity" text="Loading published groups and counselor readiness." /> : null}
      {noSearchMatch ? <Empty icon={UsersThree} title="No matching groups" text="Try another group or company name. Available groups still have space." /> : null}
      {noStandardSpace ? <Empty icon={UsersThree} title="No standard counselor group has space" text={isOnSite ? "Registration can review one supplemental placement without reopening the full roster plan." : "Every compatible published group with a ready counselor is full. Review group capacity and staffing before placing this participant."} action={isOnSite ? <button type="button" className="secondary" disabled={busy || overflowLoading || overflowBusy} onClick={reviewOverflow}>{overflowLoading ? "Checking…" : "Review overflow option"}</button> : null} /> : null}
    </div>
    {filtered.length > visible.length ? <button type="button" className="text-action regjourney-show-groups" onClick={() => setVisibleLimit((value) => value + 14)}>Show {Math.min(14, filtered.length - visible.length)} more groups</button> : null}

    {plan ? <div className="regjourney-choice-list" aria-live="polite"><div className="regjourney-choice regjourney-choice-v5 selected"><span><b>{plan.title}</b><small>{plan.meta}</small><small>{plan.note}</small></span><span className="regjourney-choice-end"><CheckCircle weight="fill" /></span></div><div className="regjourney-placement-confirm ready"><div><b>{overflowPlan.reason === "regular_space_available" ? "Use the open place" : "Review before saving"}</b><small>{overflowPlan.reason === "regular_space_available" ? "No new company or group will be created." : "Nothing is created until you confirm."}</small></div><div><button type="button" className="secondary" disabled={overflowBusy} onClick={() => { setOverflowPlan(null); setOverflowError(""); }}>Cancel</button><button type="button" className="primary" disabled={busy || overflowBusy} onClick={usePreview}>{overflowBusy ? "Saving…" : overflowPlan.reason === "regular_space_available" ? `Place ${firstName}` : `Create & place ${firstName}`}<ArrowRight /></button></div></div></div> : null}
    {overflowError ? <MutationFeedback tone="error" className="regjourney-placement-feedback">{overflowError}</MutationFeedback> : null}
    {error ? <MutationFeedback tone="error" className="regjourney-placement-feedback">{placementRefreshFailed ? <>Placement was saved, but the latest roster could not be loaded. {onRetry ? <button type="button" className="text-action regjourney-placement-retry" disabled={busy} onClick={onRetry}>Retry roster</button> : null}</> : <>Placement was not saved. {error}</>}</MutationFeedback> : null}
    {choices.length ? <div className={`regjourney-placement-confirm${selected ? " ready" : ""}`} aria-live="polite">
      <div>{selected ? <><b>{selected.displayName || selected.name}</b><small>{selectedCompany?.displayName || selectedCompany?.name || "Company"} · FSY ID will be created with this company when placement is saved.</small></> : <><b>Select a counselor group</b><small>The company follows the group. Nothing is saved until you confirm.</small></>}</div>
      <button type="button" className="primary" disabled={busy || loading || overflowBusy || !selected} aria-busy={busy || loading || overflowBusy} onClick={() => selected && void onChoose(selected)}>{busy ? "Placing…" : loading ? "Loading groups…" : selected ? `Place ${firstName}` : "Select a group"}<ArrowRight /></button>
    </div> : null}
  </div>;
}
