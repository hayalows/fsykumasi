function distributeSizes(total, minSize = 8, maxSize = 10) {
  if (!total) return [];
  if (total <= maxSize) return [total];
  let groupCount = Math.ceil(total / maxSize);
  while (groupCount > 1 && Math.floor(total / groupCount) < minSize) groupCount -= 1;
  const base = Math.floor(total / groupCount);
  const remainder = total % groupCount;
  return Array.from({ length: groupCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function averageAge(members) {
  if (!members.length) return 16;
  return members.reduce((sum, member) => sum + Number(member.age || 16), 0) / members.length;
}

function ageBand(age) {
  const value = Number(age);
  if (value >= 14 && value <= 15) return "14–15";
  if (value >= 16 && value <= 18) return "16–18";
  return "Other ages";
}

function buildPoolGroups(pool, prefix, ageBandLabel, minSize, maxSize, avoidSameUnit) {
  const sizes = distributeSizes(pool.length, minSize, maxSize);
  const groups = sizes.map((capacity, index) => ({
    id: `${prefix}-${ageBandLabel.replace(/[^0-9A-Za-z]/g, "")}-${index + 1}`,
    name: `${prefix}${ageBandLabel === "All ages" ? "" : ` ${ageBandLabel}`} Group ${index + 1}`,
    sex: pool[0]?.sex || "Unspecified",
    ageBand: ageBandLabel,
    capacity,
    members: [],
    conflicts: [],
  }));

  const unitFrequency = pool.reduce((map, participant) => {
    const unit = participant.unit || "Missing unit";
    map.set(unit, (map.get(unit) || 0) + 1);
    return map;
  }, new Map());

  const ordered = [...pool].sort((left, right) => {
    const unitDifference = (unitFrequency.get(right.unit || "Missing unit") || 0)
      - (unitFrequency.get(left.unit || "Missing unit") || 0);
    if (unitDifference) return unitDifference;
    return Number(left.age || 16) - Number(right.age || 16);
  });

  for (const participant of ordered) {
    const available = groups.filter((group) => group.members.length < group.capacity);
    const sameUnitFree = avoidSameUnit
      ? available.filter((group) => !group.members.some((member) => member.unit === participant.unit))
      : available;
    const candidates = sameUnitFree.length ? sameUnitFree : available;
    const selected = [...candidates].sort((left, right) => {
      const fillDifference = left.members.length / left.capacity - right.members.length / right.capacity;
      if (fillDifference) return fillDifference;
      return Math.abs(averageAge(left.members) - Number(participant.age || 16))
        - Math.abs(averageAge(right.members) - Number(participant.age || 16));
    })[0];

    if (!selected) continue;
    if (avoidSameUnit && selected.members.some((member) => member.unit === participant.unit)) {
      selected.conflicts.push({ type: "same-unit", participantId: participant.id, unit: participant.unit });
    }
    selected.members.push(participant);
  }

  return groups;
}

function takeCompanyGroups(female, male, target, balanceSexes, companyIndex) {
  const selected = [];
  if (!balanceSexes) {
    const pool = [];
    while (female.length || male.length) {
      if (female.length) pool.push(female.shift());
      if (male.length) pool.push(male.shift());
    }
    selected.push(...pool.splice(0, target));
    female.unshift(...pool.filter((group) => group.sex === "Female"));
    male.unshift(...pool.filter((group) => group.sex === "Male"));
    return selected;
  }

  const femaleTarget = Math.floor(target / 2) + (target % 2 && companyIndex % 2 === 0 ? 1 : 0);
  const maleTarget = target - femaleTarget;
  for (let i = 0; i < femaleTarget && female.length; i += 1) selected.push(female.shift());
  for (let i = 0; i < maleTarget && male.length; i += 1) selected.push(male.shift());
  while (selected.length < target && (female.length || male.length)) {
    if (female.length && (!male.length || female.length >= male.length)) selected.push(female.shift());
    else if (male.length) selected.push(male.shift());
  }
  return selected;
}

function buildCompanies(groups, groupsPerCompany, balanceSexes) {
  const bands = [...new Set(groups.map((group) => group.ageBand))];
  const companies = [];
  const warnings = [];

  for (const band of bands) {
    const female = groups.filter((group) => group.ageBand === band && group.sex === "Female");
    const male = groups.filter((group) => group.ageBand === band && group.sex === "Male");
    let bandIndex = 0;
    while (female.length || male.length) {
      const selected = takeCompanyGroups(female, male, groupsPerCompany, balanceSexes, bandIndex);
      if (!selected.length) break;
      const company = {
        id: `company-${companies.length + 1}`,
        name: `Company ${companies.length + 1}`,
        ageBand: band,
        groups: selected,
      };
      if (selected.length < groupsPerCompany) {
        warnings.push({
          type: "partial-company",
          companyId: company.id,
          message: `${company.name} has ${selected.length} of the preferred ${groupsPerCompany} counselor groups.`,
        });
      }
      companies.push(company);
      bandIndex += 1;
    }
  }

  return { companies, warnings };
}

export function buildBalancedAssignments(participants, options = {}) {
  const minSize = Number(options.minSize || options.groupMinSize || 8);
  const maxSize = Number(options.maxSize || options.groupMaxSize || 10);
  const groupsPerCompany = Math.max(1, Number(options.groupsPerCompany || 2));
  const useAgeBands = options.useAgeBands ?? false;
  const avoidSameUnit = options.avoidSameUnit ?? true;
  const balanceSexes = options.balanceSexes ?? true;

  const pools = participants.reduce((map, participant) => {
    const band = useAgeBands ? ageBand(participant.age) : "All ages";
    const key = `${participant.sex || "Unspecified"}|${band}`;
    if (!map.has(key)) map.set(key, { sex: participant.sex || "Unspecified", band, members: [] });
    map.get(key).members.push(participant);
    return map;
  }, new Map());

  const groups = [];
  for (const { sex, band, members } of pools.values()) {
    const prefix = sex === "Female" ? "YW" : sex === "Male" ? "YM" : "MX";
    groups.push(...buildPoolGroups(members, prefix, band, minSize, maxSize, avoidSameUnit));
  }

  const { companies, warnings } = buildCompanies(groups, groupsPerCompany, balanceSexes);
  const issues = groups.flatMap((group) => group.conflicts.map((conflict) => ({ ...conflict, groupId: group.id })));
  return {
    groups,
    companies,
    issues,
    warnings,
    settings: { minSize, maxSize, groupsPerCompany, useAgeBands, avoidSameUnit, balanceSexes },
  };
}

export { ageBand, distributeSizes };
