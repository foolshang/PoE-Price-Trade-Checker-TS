/**
 * The environment variables that only exist for tests (a fake update feed, shortened timers, a stand-in Documents folder) are read
 * through here: they count ONLY when POE_CHECKER_TEST=1 is set as well. A player's machine has neither by accident, so a stray
 * POE_UPDATE_FEED cannot send the update check to another server. Pure function of the environment, no Electron.
 */
export function testEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.POE_CHECKER_TEST !== "1") return undefined;
  return env[name] || undefined;
}
