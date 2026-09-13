export const APP_NAME = "KCC FSY 2026";
export const APP_SHORT_NAME = "KCC FSY";
export const APP_DESCRIPTOR = "Operations";
export const APP_THEME = "Walk With Me · Moses 6:34";
export const APP_ICON = "/brand/2026-theme-identifier-full-color.png";

export function canonicalSessionName(value = "") {
  const name = String(value || "").trim();
  if (!name) return APP_NAME;
  if (/^FSY Kumasi 2026 Development$/i.test(name)) return `${APP_NAME} Development`;
  if (/^FSY Kumasi 2026$/i.test(name) || /^FSY Kumasi$/i.test(name)) return APP_NAME;
  if (/^KCC FSY 2026$/i.test(name)) return APP_NAME;
  return name;
}
