import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy api/.env.example to api/.env.`);
  }
  return value;
}

// Read lazily so tests can point DATABASE_URL at the test database before anything connects.
export const config = {
  port: () => Number(process.env.PORT ?? 3001),
  databaseUrl: () => required('DATABASE_URL'),
  jwtSecret: () => required('JWT_SECRET'),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  assistantModel: () => process.env.ASSISTANT_MODEL ?? 'claude-sonnet-5-5',
  /**
   * A local-development escape hatch. The assessment key is the supported path and stays the
   * default; setting this routes the model through OpenRouter's OpenAI-compatible API instead, so
   * the feature can still be demonstrated when that key has no credit. Unset in a normal checkout.
   */
  openRouterApiKey: () => process.env.OPENROUTER_API_KEY,
};
