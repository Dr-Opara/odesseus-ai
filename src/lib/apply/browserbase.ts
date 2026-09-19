import Browserbase from "@browserbasehq/sdk";

export function createBrowserbaseClient() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("Browserbase API key is not configured.");
  return new Browserbase({ apiKey });
}

export async function createApplicationBrowserSession(input: {
  runId: string;
  userId: string;
  targetUrl: string;
}) {
  const client = createBrowserbaseClient();
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!projectId) throw new Error("Browserbase project ID is not configured.");

  const session = await client.sessions.create({
    projectId,
    keepAlive: true,
    api_timeout: 3600,
    userMetadata: {
      odysseus_run_id: input.runId,
      odysseus_user_id: input.userId,
    },
  });

  const debug = await client.sessions.debug(session.id, { expiresIn: 3600 });

  return {
    id: session.id,
    connectUrl: session.connectUrl,
    liveViewUrl: debug.debuggerFullscreenUrl,
  };
}

export async function getApplicationBrowserSession(sessionId: string) {
  const client = createBrowserbaseClient();
  const session = await client.sessions.retrieve(sessionId);

  if (!session.connectUrl) {
    throw new Error("Browser session is no longer connectable.");
  }

  const debug = await client.sessions.debug(sessionId, { expiresIn: 3600 });

  return {
    id: sessionId,
    connectUrl: session.connectUrl,
    liveViewUrl: debug.debuggerFullscreenUrl,
  };
}

export async function releaseApplicationBrowserSession(sessionId: string) {
  const client = createBrowserbaseClient();
  await client.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
}
