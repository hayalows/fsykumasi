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
  "Abrepo Ward", "Tech Junction Branch",
];

export function createDemoParticipants(count = 724) {
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
      status: index < 698 ? "Expected" : "Review",
    };
  });
}

export const demoUsers = [
  { name: "Ama Boateng", email: "ama.boateng@example.org", role: "Assistant coordinator", scope: "Companies 1–3", status: "Active" },
  { name: "Kofi Mensah", email: "kofi.mensah@example.org", role: "Coordinator", scope: "Companies 1–6", status: "Active" },
  { name: "Esi Owusu", email: "esi.owusu@example.org", role: "Logistical administrator", scope: "Whole session", status: "Active" },
  { name: "Daniel Asare", email: "daniel.asare@example.org", role: "Session directing couple", scope: "Whole session", status: "Active" },
  { name: "Mabel Osei", email: "mabel.osei@example.org", role: "Committee viewer", scope: "Food overview", status: "Invited" },
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

export const demoHeadcountRows = Array.from({ length: 12 }, (_, index) => ({
  company: `Company ${index + 1}`,
  assistantCoordinator: ["Ama Boateng", "Yaw Owusu", "Akosua Nyarko", "Kofi Mensah"][index % 4],
  expected: 58 + (index % 5),
  accounted: index < 8 ? 58 + (index % 5) : index === 8 ? 59 : 0,
  status: index < 8 ? "Reported" : index === 8 ? "Exception" : "Awaiting",
}));
