function distributeSizes(total, minSize = 8, maxSize = 10) {
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

function buildPoolGroups(pool, prefix, minSize, maxSize) {
  const sizes = distributeSizes(pool.length, minSize, maxSize);
  const groups = sizes.map((capacity, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} Group ${index + 1}`,
    sex: pool[0]?.sex || "Unspecified",
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
    const sameUnitFree = available.filter((group) => !group.members.some((member) => member.unit === participant.unit));
    const candidates = sameUnitFree.length ? sameUnitFree : available;
    const selected = [...candidates].sort((left, right) => {
      const fillDifference = left.members.length / left.capacity - right.members.length / right.capacity;
      if (fillDifference) return fillDifference;
      return Math.abs(averageAge(left.members) - Number(participant.age || 16))
        - Math.abs(averageAge(right.members) - Number(participant.age || 16));
    })[0];

    if (!selected) continue;
    if (selected.members.some((member) => member.unit === participant.unit)) {
      selected.conflicts.push({ type: "same-unit", participantId: participant.id, unit: participant.unit });
    }
    selected.members.push(participant);
  }

  return groups;
}

export function buildBalancedAssignments(participants, options = {}) {
  const minSize = options.minSize || 8;
  const maxSize = options.maxSize || 10;
  const pools = participants.reduce((map, participant) => {
    const key = participant.sex || "Unspecified";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(participant);
    return map;
  }, new Map());

  const groups = [];
  for (const [sex, pool] of pools.entries()) {
    groups.push(...buildPoolGroups(pool, sex === "Female" ? "YW" : sex === "Male" ? "YM" : "MX", minSize, maxSize));
  }

  const female = groups.filter((group) => group.sex === "Female");
  const male = groups.filter((group) => group.sex === "Male");
  const other = groups.filter((group) => !["Female", "Male"].includes(group.sex));
  const companyCount = Math.max(female.length, male.length, Math.ceil(other.length / 2));
  const companies = Array.from({ length: companyCount }, (_, index) => ({
    id: `company-${index + 1}`,
    name: `Company ${index + 1}`,
    groups: [female[index], male[index]].filter(Boolean),
  }));
  other.forEach((group, index) => companies[index % companies.length]?.groups.push(group));

  const issues = groups.flatMap((group) => group.conflicts.map((conflict) => ({ ...conflict, groupId: group.id })));
  return { groups, companies, issues };
}

export { distributeSizes };
