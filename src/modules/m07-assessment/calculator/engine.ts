/**
 * The fixed 9-step calculator formula (Build Baseline §4, BRD M07/M08).
 * Pure function: (release params, appliances, standard systems, input) → result. No I/O.
 * Every value, list and text comes from the release; the formula itself is fixed (FR-08.8).
 */
export type Segment = "RESI" | "ESS" | "CI";
export type SystemType = "SOLAR_STORAGE" | "STORAGE_ONLY" | "SOLAR_ONLY";
export type ProductInterest = SystemType | "NOT_SURE";
export type InputMethod = "APPLIANCES" | "MONTHLY_UNITS" | "RUNNING_LOAD" | "NONE";
export type Phase = "SINGLE" | "THREE";
export type RecoStatus = "RECOMMENDED" | "CUSTOM_REQUIRED" | "PENDING_TECHNICAL_DATA";

export type ReleaseParams = {
  formula: string;
  values: {
    usable_share: number;
    inverter_efficiency: number;
    surge_headroom: number;
    power_factor: number;
    solar_units_per_kwp_per_day: number;
    days_per_month: number;
  };
  segments: Record<Segment, { enabled: boolean; inputs?: InputMethod[]; message_key?: string }>;
  always_ask?: string[];
  rules: {
    alternatives_smaller: number;
    alternatives_larger: number;
    phase_must_match: boolean;
    system_type_follows_product_interest: boolean;
    not_sure_interest_allows_types: SystemType[];
    match_by_type: Record<SystemType, Array<"USABLE_BATTERY" | "INVERTER" | "SOLAR">>;
    skip_backup_inputs_for_types: SystemType[];
    motor_start: "LARGEST_MOTOR_ONLY" | "NONE";
    bill_only_power_source: "SANCTIONED_LOAD" | "NONE";
    pending_when_need_unknown: { power: InputMethod[] | string[]; battery: string[]; solar: string[] };
  };
  display: { price: "RANGE" | "HIDDEN"; gst_separate: boolean; installation_separate: boolean };
  texts: { disclaimer: string; financing_line: string; custom_required: string; pending_technical_data: string; ci_message: string; [k: string]: string };
};

export type Appliance = { name: string; defaultWatts: number; isMotor: boolean; startMultiplier: number; active?: boolean };

export type StandardSystem = {
  systemCode: string;
  systemName: string;
  forResi: boolean;
  forEss: boolean;
  forCi: boolean;
  systemType: SystemType;
  usableCapacityKwh: number;
  batteryCapacityKwh: number;
  inverterKva: number;
  phase: Phase;
  solarKwp: number;
  equipmentPriceMinInr: number;
  equipmentPriceMaxInr: number;
  installationPriceMinInr: number;
  installationPriceMaxInr: number;
  gstPct: number;
  active: boolean;
  batteryWarrantyYears?: number | null;
  inverterWarrantyYears?: number | null;
};

export type CalcInput = {
  segment: Segment;
  productInterest?: ProductInterest;
  method: InputMethod;
  appliances?: Array<{ applianceName: string; watts: number; quantity: number }>;
  monthlyUnits?: number;
  runningLoadKw?: number;
  sanctionedLoadKw?: number;
  backupHours?: number;
  phase: Phase;
};

/** OpenAPI CalcSteps: snake_case on purpose (contract). null = step skipped for the system type / not computable. */
export type CalcSteps = {
  running_load_kw: number | null;
  backup_energy_kwh: number | null;
  usable_battery_needed_kwh: number | null;
  battery_size_kwh: number | null;
  motor_start_kw: number | null;
  required_inverter_kva: number | null;
  solar_kwp: number | null;
};

export type PriceRange = { equipmentMin: number; equipmentMax: number; installationMin: number; installationMax: number; gstPct: number; totalMin: number; totalMax: number };
export type SystemOption = { systemCode: string; systemName: string; role: "RECOMMENDED" | "SMALLER" | "LARGER"; systemType: SystemType; phase: Phase; usableCapacityKwh: number; inverterKva: number; solarKwp: number; priceRange: PriceRange };

export type CalcResult = {
  releaseVersion: number;
  recommendationStatus: RecoStatus;
  steps: CalcSteps;
  options: SystemOption[];
  texts: { disclaimer: string; financingLine: string; message: string | null };
  /** Which needs could not be computed (for the UI) */
  pending: Array<"power" | "battery" | "solar">;
  /** Types considered for the match (NOT_SURE → all allowed) */
  consideredTypes: SystemType[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function priceRange(s: StandardSystem): PriceRange {
  const gst = (v: number) => Math.round(v * (1 + s.gstPct / 100));
  return {
    equipmentMin: s.equipmentPriceMinInr,
    equipmentMax: s.equipmentPriceMaxInr,
    installationMin: s.installationPriceMinInr,
    installationMax: s.installationPriceMaxInr,
    gstPct: s.gstPct,
    totalMin: gst(s.equipmentPriceMinInr + s.installationPriceMinInr),
    totalMax: gst(s.equipmentPriceMaxInr + s.installationPriceMaxInr),
  };
}

function typesFor(interest: ProductInterest | undefined, rules: ReleaseParams["rules"]): SystemType[] {
  if (!interest || interest === "NOT_SURE" || !rules.system_type_follows_product_interest) return [...rules.not_sure_interest_allows_types];
  return [interest];
}

function segmentAllows(s: StandardSystem, seg: Segment) {
  return seg === "RESI" ? s.forResi : seg === "ESS" ? s.forEss : s.forCi;
}

export function runCalculator(params: ReleaseParams, appliances: Appliance[], systems: StandardSystem[], input: CalcInput, releaseVersion: number): CalcResult {
  const v = params.values;
  const rules = params.rules;
  const texts = { disclaimer: params.texts.disclaimer, financingLine: params.texts.financing_line, message: null as string | null };
  const steps: CalcSteps = { running_load_kw: null, backup_energy_kwh: null, usable_battery_needed_kwh: null, battery_size_kwh: null, motor_start_kw: null, required_inverter_kva: null, solar_kwp: null };
  const consideredTypes = typesFor(input.productInterest, rules);

  // Segment switch (C&I off → "EPC quote required")
  const segCfg = params.segments[input.segment];
  if (!segCfg || !segCfg.enabled) {
    texts.message = params.texts[segCfg?.message_key ?? "ci_message"] ?? params.texts.ci_message;
    return { releaseVersion, recommendationStatus: "PENDING_TECHNICAL_DATA", steps, options: [], texts, pending: ["power", "battery", "solar"], consideredTypes };
  }

  const hasAppliances = input.method === "APPLIANCES" && (input.appliances?.length ?? 0) > 0;
  const hasRunning = input.method === "RUNNING_LOAD" && typeof input.runningLoadKw === "number" && input.runningLoadKw > 0;
  const hasUnits = typeof input.monthlyUnits === "number" && input.monthlyUnits > 0;
  const hasSanctioned = typeof input.sanctionedLoadKw === "number" && input.sanctionedLoadKw > 0;
  const billOnly = !hasAppliances && !hasRunning && hasUnits;

  // Step 1 — running load (kW)
  let runningLoadKw: number | null = null;
  if (hasAppliances) runningLoadKw = input.appliances!.reduce((sum, a) => sum + a.watts * a.quantity, 0) / 1000;
  else if (hasRunning) runningLoadKw = input.runningLoadKw!;
  else if (billOnly && rules.bill_only_power_source === "SANCTIONED_LOAD" && hasSanctioned) runningLoadKw = input.sanctionedLoadKw!;
  const powerKnown = runningLoadKw !== null;

  // Step 5 — motor starting power (largest motor only; zero for bill-only)
  let motorStartKw = 0;
  if (hasAppliances && rules.motor_start === "LARGEST_MOTOR_ONLY") {
    const byName = new Map(appliances.map((a) => [a.name.toLowerCase(), a]));
    let largest = 0;
    for (const line of input.appliances!) {
      const def = byName.get(line.applianceName.toLowerCase());
      if (def?.isMotor) largest = Math.max(largest, (line.watts * (def.startMultiplier - 1)) / 1000);
    }
    motorStartKw = largest;
  }

  // Backup need (steps 2–4) — skipped for SOLAR_ONLY-only consideration
  const needsBackup = consideredTypes.some((t) => !rules.skip_backup_inputs_for_types.includes(t));
  const backupHours = input.backupHours ?? null;
  let backupEnergyKwh: number | null = null;
  if (needsBackup && backupHours !== null && backupHours > 0) {
    if (powerKnown && (hasAppliances || hasRunning)) backupEnergyKwh = runningLoadKw! * backupHours;
    else if (hasUnits) backupEnergyKwh = (input.monthlyUnits! / v.days_per_month) * (backupHours / 24);
  }
  const batteryKnown = backupEnergyKwh !== null;
  const usableBatteryKwh = batteryKnown ? backupEnergyKwh! / v.inverter_efficiency : null;
  const batterySizeKwh = usableBatteryKwh !== null ? usableBatteryKwh / v.usable_share : null;

  // Step 6 — inverter (kVA)
  const inverterKva = powerKnown ? ((runningLoadKw! + motorStartKw) * (1 + v.surge_headroom)) / v.power_factor : null;

  // Step 7 — solar (kWp), from the bill only
  const solarKwp = hasUnits ? input.monthlyUnits! / v.days_per_month / v.solar_units_per_kwp_per_day : null;
  const solarKnown = solarKwp !== null;

  steps.running_load_kw = powerKnown ? r2(runningLoadKw!) : null;
  steps.motor_start_kw = powerKnown ? r2(motorStartKw) : null;
  steps.required_inverter_kva = inverterKva !== null ? r2(inverterKva) : null;
  steps.backup_energy_kwh = needsBackup && batteryKnown ? r2(backupEnergyKwh!) : null;
  steps.usable_battery_needed_kwh = needsBackup && usableBatteryKwh !== null ? r2(usableBatteryKwh) : null;
  steps.battery_size_kwh = needsBackup && batterySizeKwh !== null ? r2(batterySizeKwh) : null;
  steps.solar_kwp = consideredTypes.some((t) => rules.match_by_type[t].includes("SOLAR")) && solarKnown ? r2(solarKwp!) : null;

  // Step 8 — recommendation
  const known = { USABLE_BATTERY: batteryKnown, INVERTER: powerKnown, SOLAR: solarKnown };
  const matchable = consideredTypes.filter((t) => rules.match_by_type[t].every((d) => known[d]));
  if (!matchable.length) {
    const pending: CalcResult["pending"] = [];
    const needed = new Set(consideredTypes.flatMap((t) => rules.match_by_type[t]));
    if (needed.has("INVERTER") && !powerKnown) pending.push("power");
    if (needed.has("USABLE_BATTERY") && !batteryKnown) pending.push("battery");
    if (needed.has("SOLAR") && !solarKnown) pending.push("solar");
    texts.message = params.texts.pending_technical_data;
    return { releaseVersion, recommendationStatus: "PENDING_TECHNICAL_DATA", steps, options: [], texts, pending, consideredTypes };
  }

  const pool = systems.filter((s) => s.active && segmentAllows(s, input.segment) && matchable.includes(s.systemType) && (!rules.phase_must_match || s.phase === input.phase));
  const covers = (s: StandardSystem) =>
    rules.match_by_type[s.systemType].every((d) =>
      d === "USABLE_BATTERY" ? s.usableCapacityKwh >= usableBatteryKwh! : d === "INVERTER" ? s.inverterKva >= inverterKva! : s.solarKwp >= solarKwp!,
    );
  const sizeKey = (s: StandardSystem) => [s.usableCapacityKwh, s.inverterKva, s.solarKwp] as const;
  const cmp = (a: StandardSystem, b: StandardSystem) => {
    const ka = sizeKey(a), kb = sizeKey(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.systemCode.localeCompare(b.systemCode);
  };
  const fitting = pool.filter(covers).sort(cmp);
  const best = fitting[0];
  if (!best) {
    texts.message = params.texts.custom_required;
    return { releaseVersion, recommendationStatus: "CUSTOM_REQUIRED", steps, options: [], texts, pending: [], consideredTypes };
  }
  const sameType = pool.filter((s) => s.systemType === best.systemType).sort(cmp);
  const idx = sameType.findIndex((s) => s.systemCode === best.systemCode);
  const smaller = sameType.slice(Math.max(0, idx - rules.alternatives_smaller), idx);
  const larger = sameType.slice(idx + 1, idx + 1 + rules.alternatives_larger);
  const opt = (s: StandardSystem, role: SystemOption["role"]): SystemOption => ({
    systemCode: s.systemCode, systemName: s.systemName, role, systemType: s.systemType, phase: s.phase,
    usableCapacityKwh: s.usableCapacityKwh, inverterKva: s.inverterKva, solarKwp: s.solarKwp, priceRange: priceRange(s),
  });
  const options = [...smaller.map((s) => opt(s, "SMALLER")), opt(best, "RECOMMENDED"), ...larger.map((s) => opt(s, "LARGER"))];
  return { releaseVersion, recommendationStatus: "RECOMMENDED", steps, options, texts, pending: [], consideredTypes };
}

/** Manual / EPC assessment status (FR-07.3, OpenAPI AssessmentCreate): no size at all = PENDING. */
export function manualStatus(manual: { batteryKwh?: number; inverterKva?: number; solarKwp?: number }): RecoStatus {
  const any = [manual.batteryKwh, manual.inverterKva, manual.solarKwp].some((x) => typeof x === "number" && x > 0);
  return any ? "CUSTOM_REQUIRED" : "PENDING_TECHNICAL_DATA";
}

/** Worked example from the Build Baseline (preloaded in the test bench). */
export const WORKED_EXAMPLE: CalcInput = {
  segment: "RESI",
  productInterest: "SOLAR_STORAGE",
  method: "APPLIANCES",
  appliances: [
    { applianceName: "Ceiling fan", watts: 75, quantity: 4 },
    { applianceName: "LED bulb", watts: 10, quantity: 6 },
    { applianceName: "Television", watts: 100, quantity: 1 },
    { applianceName: "Refrigerator", watts: 200, quantity: 1 },
  ],
  monthlyUnits: 300,
  backupHours: 4,
  phase: "SINGLE",
};
