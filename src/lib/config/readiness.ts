export function missingEnv(keys: readonly string[]) {
  return keys.filter((key) => !process.env[key]?.trim());
}

export function integrationNotConfigured(
  name: string,
  missing: readonly string[]
) {
  return {
    error: `${name} is not configured yet.`,
    code: "INTEGRATION_NOT_CONFIGURED",
    missing,
  };
}
