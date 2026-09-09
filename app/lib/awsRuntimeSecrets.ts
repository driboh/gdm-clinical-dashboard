import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";

export async function loadAwsRuntimeSecrets(parameterPrefix: string) {
  const prefix = parameterPrefix.replace(/\/$/, "");
  const names = [`${prefix}/DATABASE_URL`, `${prefix}/BETTER_AUTH_SECRET`];
  const client = new SSMClient({});
  const response = await client.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  const values = new Map(response.Parameters?.map((parameter) => [parameter.Name, parameter.Value]) || []);
  const databaseUrl = values.get(names[0]);
  const betterAuthSecret = values.get(names[1]);

  if (!databaseUrl || !betterAuthSecret) {
    throw new Error("The AWS runtime secret parameters are unavailable.");
  }

  process.env.DATABASE_URL ||= databaseUrl;
  process.env.BETTER_AUTH_SECRET ||= betterAuthSecret;
}
