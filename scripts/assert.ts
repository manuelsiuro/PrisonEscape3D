/** Tiny assertion helper for the headless test scripts: failures are reported and set a non-zero exit code. */
export function check(ok: boolean, message: string) {
  if (ok) return;
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}
