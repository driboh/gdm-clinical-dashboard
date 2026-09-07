export type MedicationChangeDraft = {
  medication: string;
  previousDose: string;
  newDose: string;
  previousTiming: string;
  newTiming: string;
  reason: string;
  comments: string;
  confirmed: boolean;
  /** Legacy single-timing value, accepted only while normalizing saved drafts. */
  timing?: string;
};

export function normalizeMedicationChangeDraft(
  value: Partial<MedicationChangeDraft> | undefined,
  defaults: Partial<MedicationChangeDraft> = {},
): MedicationChangeDraft {
  const legacyTiming = value?.timing?.trim() || "";
  const previousTiming = value?.previousTiming !== undefined
    ? value.previousTiming.trim()
    : legacyTiming || defaults.previousTiming?.trim() || "";
  const newTiming = value?.newTiming !== undefined
    ? value.newTiming.trim()
    : legacyTiming || defaults.newTiming?.trim() || previousTiming;
  return {
    medication: value?.medication ?? defaults.medication ?? "",
    previousDose: value?.previousDose ?? defaults.previousDose ?? "",
    newDose: value?.newDose ?? defaults.newDose ?? "",
    previousTiming,
    newTiming,
    reason: value?.reason ?? defaults.reason ?? "",
    comments: value?.comments ?? defaults.comments ?? "",
    confirmed: value?.confirmed === true,
  };
}

export function medicationChangeIsComplete(noMedicationChange: boolean, value: MedicationChangeDraft) {
  if (noMedicationChange) return true;
  return Boolean(
    value.confirmed && value.medication.trim() && value.previousDose.trim() && value.newDose.trim() &&
    value.previousTiming.trim() && value.newTiming.trim(),
  );
}
