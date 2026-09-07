import assert from "node:assert/strict";
import test from "node:test";
import {
  medicationChangeIsComplete,
  normalizeMedicationChangeDraft,
  type MedicationChangeDraft,
} from "../app/lib/medicationChangeValidation.ts";

const complete = (overrides: Partial<MedicationChangeDraft> = {}) => normalizeMedicationChangeDraft({
  medication: "Basaglar",
  previousDose: "5",
  previousTiming: "QHS",
  newDose: "7",
  newTiming: "QHS",
  reason: "Fictional elevated fasting values",
  confirmed: true,
  ...overrides,
});

test("confirmed Basaglar dose-only change at QHS can finalize", () => {
  assert.equal(medicationChangeIsComplete(false, complete()), true);
});

test("unconfirmed medication change is blocked", () => {
  assert.equal(medicationChangeIsComplete(false, complete({ confirmed: false })), false);
});

test("confirmed dose and timing change can finalize", () => {
  assert.equal(medicationChangeIsComplete(false, complete({ newTiming: "QAM" })), true);
});

test("missing previous dose or timing is blocked", () => {
  assert.equal(medicationChangeIsComplete(false, complete({ previousDose: "" })), false);
  assert.equal(medicationChangeIsComplete(false, complete({ previousTiming: "" })), false);
});

test("missing new dose or timing is blocked", () => {
  assert.equal(medicationChangeIsComplete(false, complete({ newDose: "" })), false);
  assert.equal(medicationChangeIsComplete(false, complete({ newTiming: "" })), false);
});

test("no medication change follows the normal finalization path", () => {
  assert.equal(medicationChangeIsComplete(true, normalizeMedicationChangeDraft(undefined)), true);
});

test("PostgreSQL draft JSON round-trip preserves confirmation and both timings", () => {
  const before = complete(), after = normalizeMedicationChangeDraft(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(after, before);
  assert.equal(after.confirmed, true);
  assert.equal(after.previousTiming, "QHS");
  assert.equal(after.newTiming, "QHS");
});

test("legacy manually entered single timing is safely normalized to both sides", () => {
  const value = normalizeMedicationChangeDraft({
    medication: "Basaglar", previousDose: "5", newDose: "7", timing: "QHS", confirmed: true,
  });
  assert.equal(value.previousTiming, "QHS");
  assert.equal(value.newTiming, "QHS");
  assert.equal(medicationChangeIsComplete(false, value), true);
});
