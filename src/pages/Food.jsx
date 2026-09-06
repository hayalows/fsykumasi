/**
 * Stable Food route contract. The active implementation lives in FoodV2 so the
 * public route stays unchanged while the workspace can evolve independently.
 *
 * Access remains capability-driven through food_view / meal attendance roles.
 * Participant serving remains a type="checkbox" interaction. Each tick saves immediately.
 * Dietary needs remain a separate Food workflow and do not load with the serving desk.
 */
export { Food } from "./FoodV2.jsx";
