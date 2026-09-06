function textOf(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.error_description || String(error);
}

export function makeSupportReference(value = "") {
  const input = String(value || "FSY");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `FSY-${Math.abs(hash >>> 0).toString(36).slice(0, 6).toUpperCase().padEnd(6, "0")}`;
}

export function friendlyRuntimeError(error) {
  const raw = textOf(error).trim();
  const lower = raw.toLowerCase();
  const supportReference = makeSupportReference(raw || "runtime");

  if (/jwt|issued at future|pgrst303|token.*future|token.*invalid/.test(lower)) {
    return {
      title: "Live FSY data did not load",
      message: "Your sign-in worked, but the live data service did not respond correctly. Try again in a moment.",
      supportReference,
      transient: true,
    };
  }

  if (/failed to fetch|network|load failed|timeout|timed out|offline|connection/.test(lower)) {
    return {
      title: "We could not reach live FSY data",
      message: "Check your connection and try again. If you already loaded the app, some information on this device may be out of date.",
      supportReference,
      transient: true,
    };
  }

  if (/permission|not allowed|outside your scope|cannot manage|access denied|unauthorized|forbidden/.test(lower)) {
    return {
      title: "This action is not in your access",
      message: "Your account is signed in, but this FSY responsibility is not currently assigned to you.",
      supportReference,
      transient: false,
    };
  }

  return {
    title: "Live FSY data did not load",
    message: "Try again. If it keeps happening, share the support reference with the FSY administrator.",
    supportReference,
    transient: true,
  };
}

export function relativeFreshness(value, now = Date.now()) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 15) return "updated just now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(time))}`;
}
