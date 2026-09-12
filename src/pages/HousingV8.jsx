import { useState } from "react";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { MapTrifold } from "@phosphor-icons/react/MapTrifold";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { PageHead } from "../components/UI.jsx";
import { hasCapability } from "../lib/field-operations.js";
import { Housing as HousingLiveV6 } from "./HousingV6.jsx";
import { HousingInventoryV8 } from "./HousingInventoryV8.jsx";
import { HousingPlanningV8 } from "./HousingPlanningV8.jsx";
import "./housing-v8.css";

function WorkspaceNav({ mode, onChange }) {
  const options = [
    { value: "live", label: "Live Housing", help: "Assign arrivals", icon: Lightning },
    { value: "plan", label: "Plan", help: "Company blocks", icon: MapTrifold },
    { value: "inventory", label: "Inventory", help: "Rooms & imports", icon: Buildings },
  ];
  return <nav className="housing-v8-mode-nav" aria-label="Housing workspaces">{options.map((option) => {
    const Icon = option.icon;
    return <button key={option.value} type="button" className={mode === option.value ? "active" : ""} aria-current={mode === option.value ? "page" : undefined} onClick={() => onChange(option.value)}><Icon/><span><b>{option.label}</b><small>{option.help}</small></span></button>;
  })}</nav>;
}

export function Housing(props) {
  const { sessionId, capabilities = [], sessionName } = props;
  const [mode, setMode] = useState("live");
  const canView = hasCapability(capabilities, "housing_view");
  const canManage = hasCapability(capabilities, "housing_manage");

  if (mode === "live") return <div className="housing-v8-shell"><div className="housing-v8-mode-wrap"><WorkspaceNav mode={mode} onChange={setMode}/></div><HousingLiveV6 {...props}/></div>;

  return <section className="page housing-v8-shell">
    <PageHead title="Housing" sessionName={sessionName} description={mode === "plan" ? "Plan Company × Sex room blocks before live assignments begin." : "Maintain the physical room inventory without changing application code."}/>
    <WorkspaceNav mode={mode} onChange={setMode}/>
    {!canView ? <article className="panel"><p>Housing access is not assigned to this account.</p></article> : mode === "plan" ? <HousingPlanningV8 sessionId={sessionId} canManage={canManage}/> : <HousingInventoryV8 sessionId={sessionId} canManage={canManage}/>} 
  </section>;
}
