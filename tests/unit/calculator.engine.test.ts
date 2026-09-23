import { describe, it, expect } from "vitest";
import { runCalculator, WORKED_EXAMPLE, manualStatus, type ReleaseParams, type Appliance, type StandardSystem } from "@/modules/m07-assessment/calculator/engine";
import { SEED_RELEASE_PARAMS, SEED_APPLIANCES } from "@/modules/m08-calc-designer/seedRelease";

const params: ReleaseParams = SEED_RELEASE_PARAMS;
const appliances: Appliance[] = SEED_APPLIANCES;

const sys = (o: Partial<StandardSystem> & { systemCode: string; systemType: StandardSystem["systemType"] }): StandardSystem => ({
  systemName: o.systemCode, forResi: true, forEss: true, forCi: false, usableCapacityKwh: 4.5, batteryCapacityKwh: 5, inverterKva: 5, phase: "SINGLE", solarKwp: 3,
  equipmentPriceMinInr: 200000, equipmentPriceMaxInr: 250000, installationPriceMinInr: 15000, installationPriceMaxInr: 25000, gstPct: 12, active: true, ...o,
});

const systems: StandardSystem[] = [
  sys({ systemCode: "SS-S2-B3", systemType: "SOLAR_STORAGE", usableCapacityKwh: 2.7, batteryCapacityKwh: 3, inverterKva: 2.5, solarKwp: 2 }),
  sys({ systemCode: "SS-S3-B5", systemType: "SOLAR_STORAGE", usableCapacityKwh: 4.5, batteryCapacityKwh: 5, inverterKva: 5, solarKwp: 3 }),
  sys({ systemCode: "SS-S5-B10", systemType: "SOLAR_STORAGE", usableCapacityKwh: 9, batteryCapacityKwh: 10, inverterKva: 7.5, solarKwp: 5 }),
  sys({ systemCode: "ST-B5", systemType: "STORAGE_ONLY", usableCapacityKwh: 4.5, inverterKva: 5, solarKwp: 0 }),
  sys({ systemCode: "SO-S3", systemType: "SOLAR_ONLY", usableCapacityKwh: 0, batteryCapacityKwh: 0, inverterKva: 3, solarKwp: 3 }),
  sys({ systemCode: "SS-3PH", systemType: "SOLAR_STORAGE", phase: "THREE", usableCapacityKwh: 13.5, batteryCapacityKwh: 15, inverterKva: 10, solarKwp: 5 }),
];

describe("9-step calculator (Build Baseline §4)", () => {
  it("reproduces the worked example exactly", () => {
    const r = runCalculator(params, appliances, systems, WORKED_EXAMPLE, 1);
    expect(r.steps.running_load_kw).toBe(0.66);
    expect(r.steps.backup_energy_kwh).toBe(2.64);
    expect(r.steps.usable_battery_needed_kwh).toBe(2.93);
    expect(r.steps.battery_size_kwh).toBe(3.26);
    expect(r.steps.motor_start_kw).toBe(0.4);
    expect(r.steps.required_inverter_kva).toBe(1.46);
    expect(r.steps.solar_kwp).toBe(2.5);
    expect(r.recommendationStatus).toBe("RECOMMENDED");
    // smallest covering: usable 2.93 → SS-S3-B5 (4.5), inverter 1.46 ok, solar 2.5 → 3
    const rec = r.options.find((o) => o.role === "RECOMMENDED")!;
    expect(rec.systemCode).toBe("SS-S3-B5");
    expect(r.options.map((o) => o.role)).toEqual(["SMALLER", "RECOMMENDED", "LARGER"]);
    expect(r.options[0].systemCode).toBe("SS-S2-B3");
    expect(r.options[2].systemCode).toBe("SS-S5-B10");
  });

  it("no power data → PENDING_TECHNICAL_DATA, never CUSTOM_REQUIRED (earned rule 2, UAT-11)", () => {
    const r = runCalculator(params, appliances, systems, { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "NONE", backupHours: 4, phase: "SINGLE" }, 1);
    expect(r.recommendationStatus).toBe("PENDING_TECHNICAL_DATA");
    expect(r.pending).toEqual(["power", "battery", "solar"]);
    expect(r.texts.message).toBe(params.texts.pending_technical_data);
    expect(r.options).toEqual([]);
  });

  it("need above the largest system → CUSTOM_REQUIRED with empty options (UAT-12)", () => {
    const r = runCalculator(params, appliances, systems, { ...WORKED_EXAMPLE, appliances: [{ applianceName: "Air conditioner (1.5 ton)", watts: 1600, quantity: 6 }], backupHours: 8 }, 1);
    expect(r.recommendationStatus).toBe("CUSTOM_REQUIRED");
    expect(r.options).toEqual([]);
    expect(r.texts.message).toBe(params.texts.custom_required);
  });

  it("solar only: no backup steps, matched on solar kWp and phase (UAT-13)", () => {
    const r = runCalculator(params, appliances, systems, { segment: "RESI", productInterest: "SOLAR_ONLY", method: "MONTHLY_UNITS", monthlyUnits: 300, phase: "SINGLE" }, 1);
    expect(r.steps.backup_energy_kwh).toBeNull();
    expect(r.steps.battery_size_kwh).toBeNull();
    expect(r.steps.solar_kwp).toBe(2.5);
    expect(r.recommendationStatus).toBe("RECOMMENDED");
    expect(r.options.find((o) => o.role === "RECOMMENDED")!.systemCode).toBe("SO-S3");
  });

  it("storage only: solar step skipped", () => {
    const r = runCalculator(params, appliances, systems, { ...WORKED_EXAMPLE, productInterest: "STORAGE_ONLY", monthlyUnits: undefined }, 1);
    expect(r.steps.solar_kwp).toBeNull();
    expect(r.recommendationStatus).toBe("RECOMMENDED");
    expect(r.options.find((o) => o.role === "RECOMMENDED")!.systemCode).toBe("ST-B5");
  });

  it("not sure: all types considered; a smaller storage-only system wins when it covers the need", () => {
    const r = runCalculator(params, appliances, systems, { ...WORKED_EXAMPLE, productInterest: "NOT_SURE" }, 1);
    expect(r.consideredTypes).toEqual(["SOLAR_STORAGE", "STORAGE_ONLY", "SOLAR_ONLY"]);
    expect(r.recommendationStatus).toBe("RECOMMENDED");
  });

  it("phase must match", () => {
    const r = runCalculator(params, appliances, systems, { ...WORKED_EXAMPLE, phase: "THREE" }, 1);
    expect(r.options.find((o) => o.role === "RECOMMENDED")!.systemCode).toBe("SS-3PH");
  });

  it("bill-only sizing uses sanctioned load for power and has no motor surge (C.8)", () => {
    const r = runCalculator(params, appliances, systems, { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "MONTHLY_UNITS", monthlyUnits: 300, sanctionedLoadKw: 3, backupHours: 4, phase: "SINGLE" }, 1);
    expect(r.steps.running_load_kw).toBe(3);
    expect(r.steps.motor_start_kw).toBe(0);
    expect(r.steps.backup_energy_kwh).toBe(1.67); // (300/30) × 4/24
    expect(r.recommendationStatus).toBe("RECOMMENDED");
  });

  it("bill-only without sanctioned load: power pending, battery and solar known", () => {
    const r = runCalculator(params, appliances, systems, { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "MONTHLY_UNITS", monthlyUnits: 300, backupHours: 4, phase: "SINGLE" }, 1);
    expect(r.recommendationStatus).toBe("PENDING_TECHNICAL_DATA");
    expect(r.pending).toEqual(["power"]);
  });

  it("C&I: calculator off, EPC quote required (UAT-14)", () => {
    const r = runCalculator(params, appliances, systems, { ...WORKED_EXAMPLE, segment: "CI" }, 1);
    expect(r.texts.message).toBe("EPC quote required.");
    expect(r.options).toEqual([]);
  });

  it("manual entry without sizes is PENDING; with sizes CUSTOM_REQUIRED", () => {
    expect(manualStatus({})).toBe("PENDING_TECHNICAL_DATA");
    expect(manualStatus({ batteryKwh: 5 })).toBe("CUSTOM_REQUIRED");
  });
});
