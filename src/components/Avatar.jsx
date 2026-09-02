import { Navii } from "@usenavii/react";

const DEMO_AVATAR_SEED = "demo-fsy-kumasi-leader";

export function accountAvatarSeed(user) {
  return user?.user_id || user?.id || DEMO_AVATAR_SEED;
}

export function AccountAvatar({ seed = DEMO_AVATAR_SEED, label = "FSY leader", size = 40, className = "" }) {
  const stableSeed = typeof seed === "string" && seed.trim() ? seed : DEMO_AVATAR_SEED;
  return (
    <span className={`navii-avatar ${className}`.trim()} aria-hidden="true">
      <Navii seed={stableSeed} size={size} title={label} alt="" />
    </span>
  );
}

