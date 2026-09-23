import type { ReleaseParams, Appliance } from "@/modules/m07-assessment/calculator/engine";

/** Mirror of Calculator Release v1 in ecofy_seed_v1.1.sql — used by unit tests and the test bench defaults. */
export const SEED_RELEASE_PARAMS: ReleaseParams = {
  formula: "FIXED_9_STEP_V1",
  values: { usable_share: 0.9, inverter_efficiency: 0.9, surge_headroom: 0.1, power_factor: 0.8, solar_units_per_kwp_per_day: 4, days_per_month: 30 },
  segments: {
    RESI: { enabled: true, inputs: ["APPLIANCES", "MONTHLY_UNITS"] },
    ESS: { enabled: true, inputs: ["APPLIANCES", "MONTHLY_UNITS", "RUNNING_LOAD"] },
    CI: { enabled: false, message_key: "ci_message" },
  },
  always_ask: ["BACKUP_HOURS", "PHASE"],
  rules: {
    alternatives_smaller: 1,
    alternatives_larger: 1,
    phase_must_match: true,
    system_type_follows_product_interest: true,
    not_sure_interest_allows_types: ["SOLAR_STORAGE", "STORAGE_ONLY", "SOLAR_ONLY"],
    match_by_type: { SOLAR_STORAGE: ["USABLE_BATTERY", "INVERTER", "SOLAR"], STORAGE_ONLY: ["USABLE_BATTERY", "INVERTER"], SOLAR_ONLY: ["SOLAR"] },
    skip_backup_inputs_for_types: ["SOLAR_ONLY"],
    motor_start: "LARGEST_MOTOR_ONLY",
    bill_only_power_source: "SANCTIONED_LOAD",
    pending_when_need_unknown: { power: ["APPLIANCES", "RUNNING_LOAD", "SANCTIONED_LOAD"], battery: ["APPLIANCES", "RUNNING_LOAD", "MONTHLY_UNITS"], solar: ["MONTHLY_UNITS"] },
  },
  display: { price: "RANGE", gst_separate: true, installation_separate: true },
  texts: {
    disclaimer: "Indicative price range. The final price comes from the EPC partner's quote.",
    financing_line: "Financing through Ecofy, subject to sanction.",
    custom_required: "No standard system fits. Custom configuration required; request an EPC quote.",
    pending_technical_data: "Recommendation pending: power or load details are missing. A provisional EPC quote needs a recorded reason.",
    ci_message: "EPC quote required.",
  },
};

export const SEED_APPLIANCES: Appliance[] = [
  { name: "LED bulb", defaultWatts: 10, isMotor: false, startMultiplier: 1 },
  { name: "LED tube light", defaultWatts: 20, isMotor: false, startMultiplier: 1 },
  { name: "Ceiling fan", defaultWatts: 75, isMotor: false, startMultiplier: 1 },
  { name: "Wi-Fi router", defaultWatts: 15, isMotor: false, startMultiplier: 1 },
  { name: "Laptop", defaultWatts: 60, isMotor: false, startMultiplier: 1 },
  { name: "Television", defaultWatts: 100, isMotor: false, startMultiplier: 1 },
  { name: "Desktop computer", defaultWatts: 150, isMotor: false, startMultiplier: 1 },
  { name: "Refrigerator", defaultWatts: 200, isMotor: true, startMultiplier: 3 },
  { name: "Air cooler", defaultWatts: 200, isMotor: false, startMultiplier: 1 },
  { name: "Washing machine", defaultWatts: 500, isMotor: true, startMultiplier: 2 },
  { name: "Mixer grinder", defaultWatts: 500, isMotor: true, startMultiplier: 2 },
  { name: "Water pump (1 HP)", defaultWatts: 750, isMotor: true, startMultiplier: 3 },
  { name: "Air conditioner (1 ton)", defaultWatts: 1200, isMotor: true, startMultiplier: 3 },
  { name: "Air conditioner (1.5 ton)", defaultWatts: 1600, isMotor: true, startMultiplier: 3 },
];
