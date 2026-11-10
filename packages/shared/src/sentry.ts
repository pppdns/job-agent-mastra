/**
 * Sentry `dataCollection` for every runtime (agent, web server/edge, browser). Sentry v11 collects
 * all of these by default when the option is omitted; this app's events carry private profile and
 * chat content, so every category is off. Events keep the error, stack, tags, release and URL path.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
