import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { demoData, newId, type AppData, type SubmittedReading } from "../app/lib/data.ts";
import { editSubmittedReading, patientPortalService } from "../app/lib/patientPortalService.ts";

const copyData = (): AppData => JSON.parse(JSON.stringify(demoData));
const row = (date: string, fasting = 101): SubmittedReading => ({
  id: newId("submitted-reading"),
  date,
  fasting,
  breakfast: 126,
  lunch: 119,
  dinner: 133,
  notes: "Fictional portal test",
});

test("creates an opaque revocable invitation and a valid local QR image", async () => {
  const patient = demoData.patients[0];
  const { data, access } = patientPortalService.createInvitation(copyData(), patient.id);
  assert.equal(access.status, "Active");
  assert.equal(access.token.includes(patient.mrn), false);
  assert.equal(access.token.toLowerCase().includes(patient.lastName.toLowerCase()), false);
  assert.equal(patientPortalService.resolveAccess(data, access.token)?.patientId, patient.id);
  const qr = await QRCode.toDataURL(`https://example.test/patient/submit/${access.token}`);
  assert.match(qr, /^data:image\/png;base64,/);
  const disabled = patientPortalService.disableAccess(data, patient.id);
  assert.equal(patientPortalService.resolveAccess(disabled, access.token), undefined);
  assert.throws(() => patientPortalService.submit(disabled, access.token, [row("2026-08-01")]));
});

test("patient values remain pending until review, edits preserve originals, and import stays patient-specific", () => {
  const base = copyData(), patient = base.patients[0];
  const invited = patientPortalService.createInvitation(base, patient.id);
  const dates = Array.from({ length: 7 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
  const submitted = patientPortalService.submit(invited.data, invited.access.token, dates.map((date, index) => row(date, 96 + index)));
  const pending = submitted.patientSubmissions[0];
  assert.equal(pending.status, "Pending");
  assert.equal(submitted.readings.some((x) => x.sourceSubmissionId === pending.id), false);

  const edited = editSubmittedReading(pending.readings[0], "fasting", 99, "Daniel Riboh, PA-C");
  assert.equal(edited.original?.fasting, 96);
  assert.equal(edited.editHistory?.[0].originalValue, 96);
  const reviewed = patientPortalService.edit(submitted, pending.id, [edited, ...pending.readings.slice(1)], "Daniel Riboh, PA-C");
  const imported = patientPortalService.approveAndImport(reviewed, pending.id, "Daniel Riboh, PA-C");
  assert.equal(imported.patientSubmissions[0].status, "Imported");
  assert.equal(imported.readings.find((x) => x.sourceSubmissionId === pending.id)?.source, "Patient Portal");
  assert.equal(imported.readings.find((x) => x.sourceSubmissionId === pending.id)?.fasting, 99);
  assert.equal(imported.readings.some((x) => x.patientId !== patient.id && x.sourceSubmissionId === pending.id), false);
  assert.ok(imported.auditEvents.some((x) => x.action === "Submission approved and imported"));
});

test("duplicate readings require an explicit keep, replace, or skip decision", () => {
  const base = copyData(), patient = base.patients[0], duplicateDate = base.readings.find((x) => x.patientId === patient.id)!.date;
  const existing = base.readings.find((x) => x.patientId === patient.id && x.date === duplicateDate)!;
  const invited = patientPortalService.createInvitation(base, patient.id);
  const submitted = patientPortalService.submit(invited.data, invited.access.token, [row(duplicateDate, 177)]);
  const submission = submitted.patientSubmissions[0];
  assert.deepEqual(patientPortalService.duplicates(submitted, submission), [duplicateDate]);
  assert.throws(() => patientPortalService.approveAndImport(submitted, submission.id, "Daniel Riboh, PA-C"));

  const kept = patientPortalService.approveAndImport(submitted, submission.id, "Daniel Riboh, PA-C", { [duplicateDate]: "keep" });
  assert.equal(kept.readings.find((x) => x.id === existing.id)?.fasting, existing.fasting);
  const replaced = patientPortalService.approveAndImport(submitted, submission.id, "Daniel Riboh, PA-C", { [duplicateDate]: "replace" });
  assert.equal(replaced.readings.find((x) => x.id === existing.id)?.fasting, 177);
  const skipped = patientPortalService.approveAndImport(submitted, submission.id, "Daniel Riboh, PA-C", { [duplicateDate]: "skip" });
  assert.equal(skipped.readings.find((x) => x.id === existing.id)?.fasting, existing.fasting);
});

test("a clinician can reject a pending submission without importing readings", () => {
  const base = copyData(), patient = base.patients[1];
  const invited = patientPortalService.createInvitation(base, patient.id);
  const submitted = patientPortalService.submit(invited.data, invited.access.token, [row("2026-08-20")]);
  const rejected = patientPortalService.reject(submitted, submitted.patientSubmissions[0].id, "Daniel Riboh, PA-C");
  assert.equal(rejected.patientSubmissions[0].status, "Rejected");
  assert.equal(rejected.readings.some((x) => x.patientId === patient.id && x.date === "2026-08-20"), false);
});
