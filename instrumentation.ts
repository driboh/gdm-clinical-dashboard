export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET) return;

  const parameterPrefix = process.env.GDM_RUNTIME_SECRET_PREFIX;
  if (!parameterPrefix) return;

  const { loadAwsRuntimeSecrets } = await import("./app/lib/awsRuntimeSecrets");
  await loadAwsRuntimeSecrets(parameterPrefix);
}
