const firstNames = [
  "Abena", "Akosua", "Ama", "Adwoa", "Afia", "Esi", "Yaa", "Nana",
  "Kwame", "Kofi", "Kojo", "Yaw", "Kwaku", "Kwesi", "Fiifi", "Elorm",
  "Priscilla", "Mabel", "Ruth", "Grace", "Daniel", "Joseph", "Samuel", "Michael",
];

const lastNames = [
  "Mensah", "Boateng", "Owusu", "Asare", "Osei", "Agyeman", "Appiah", "Frimpong",
  "Antwi", "Acheampong", "Opoku", "Darko", "Adjei", "Boadu", "Amankwah", "Sarpong",
];

export const units = [
  "Asokwa Ward", "Bantama Ward", "Kwadaso Ward", "Ahodwo Ward",
  "Ayigya Ward", "Dichemso Branch", "Suame Ward", "Oduom Ward",
  "Santasi Ward", "Tafo Ward", "Nhyiaeso Ward", "Ejisu Branch",
  "Abrepo Ward", "Tech Junction Branch", "Atonsu Ward", "Obuasi Ward",
  "Konongo Branch", "Mampong Branch", "Ejura Branch", "Bekwai Ward",
];

export function createDemoParticipants(count = 1640) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const firstName = firstNames[(index * 7 + Math.floor(index / 11)) % firstNames.length];
    const lastName = lastNames[(index * 5 + Math.floor(index / 13)) % lastNames.length];
    const unit = units[(index * 5 + Math.floor(index / 14)) % units.length];
    return {
      id: `FSY-${String(number).padStart(4, "0")}`,
      registrationId: `REG-${String(26000 + number)}`,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      sex: index % 2 === 0 ? "Female" : "Male",
      age: 14 + (index % 5),
      unit,
      status: index < Math.floor(count * 0.97) ? "Expected" : "Review",
    };
  });
}

export const demoStaffSummary = {
  ysaStaff: 188,
  counselors: 164,
  assistantCoordinators: 28,
  coordinators: 6,
};

export const demoUsers = [
  { name: "Ama Boateng", email: "ama.boateng@example.org", role: "Assistant coordinator", roleKey: "assistant_coordinator", scope: "Companies 1–4", status: "Active" },
  { name: "Kofi Mensah", email: "kofi.mensah@example.org", role: "Coordinator", roleKey: "coordinator", scope: "Whole session", status: "Active" },
  { name: "Esi Owusu", email: "esi.owusu@example.org", role: "Logistical administrator", roleKey: "logistics_admin", scope: "Whole session", status: "Active" },
  { name: "Daniel Asare", email: "daniel.asare@example.org", role: "Session directing couple", roleKey: "session_director", scope: "Whole session", status: "Active" },
  { name: "Mabel Osei", email: "mabel.osei@example.org", role: "Committee viewer", roleKey: "committee_viewer", scope: "Food overview", status: "Pending" },
];

export const demoAccessRequests = [
  { id: "req-1", name: "Mabel Osei", email: "mabel.osei@example.org", role: "committee_viewer", scope: "Food overview", requested: "18 min ago", status: "pending" },
  { id: "req-2", name: "Yaw Boadu", email: "yaw.boadu@example.org", role: "assistant_coordinator", scope: "Companies 21–24", requested: "34 min ago", status: "pending" },
  { id: "req-3", name: "Akosua Frimpong", email: "akosua.frimpong@example.org", role: "coordinator", scope: "Whole session", requested: "1 hr ago", status: "pending" },
];

export const setupSteps = [
  { id: "details", label: "Conference details", short: "Details" },
  { id: "import", label: "Import participants", short: "Import" },
  { id: "review", label: "Review data", short: "Review" },
  { id: "groups", label: "Build groups", short: "Groups" },
  { id: "companies", label: "Form companies", short: "Companies" },
  { id: "staff", label: "Assign staff", short: "Staff" },
  { id: "ready", label: "Ready for check-in", short: "Ready" },
];

export const demoHeadcountRows = Array.from({ length: 82 }, (_, index) => {
  const expected = 18 + (index % 5);
  const status = index < 76 ? "Reported" : index < 79 ? "Exception" : "Awaiting";
  return {
    company: `Company ${index + 1}`,
    assistantCoordinator: ["Ama Boateng", "Yaw Owusu", "Akosua Nyarko", "Kofi Mensah", "Ruth Adjei"][index % 5],
    expected,
    accounted: status === "Reported" ? expected : status === "Exception" ? expected - 1 : 0,
    status,
  };
});
