/**
 * The names of keys on this player's keyboard. The game reads physical keys (`e.code`:
 * the key where W is on a QWERTY keyboard moves up everywhere), so on an AZERTY keyboard
 * that key is labelled Z. Texts write a key as `%KeyW%` and get the label printed on it.
 *
 * Chrome tells the layout (navigator.keyboard); elsewhere a French (France, Belgium)
 * browser is taken to mean AZERTY.
 */
const labels = new Map<string, string>();

const AZERTY: Record<string, string> = { KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', KeyM: ',', Semicolon: 'M' };
if (/^fr(-(fr|be|lu|mc))?$/i.test(globalThis.navigator?.language ?? '')) for (const [k, v] of Object.entries(AZERTY)) labels.set(k, v);

type LayoutMap = { get(code: string): string | undefined };
const keyboard = (globalThis.navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } } | undefined)?.keyboard;
keyboard
  ?.getLayoutMap?.()
  .then((m) => {
    labels.clear();
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'KeyE', 'KeyR']) {
      const k = m.get(code);
      if (k) labels.set(code, k.toUpperCase());
    }
  })
  .catch(() => {});

/** The label on the key with this code ('KeyW' → 'W', or 'Z' on AZERTY). */
export const keyLabel = (code: string) => labels.get(code) ?? (code.startsWith('Key') ? code.slice(3) : code);

/** Fills `%KeyW%` placeholders with this keyboard's labels. */
export const withKeys = (s: string) => (s.includes('%') ? s.replace(/%(Key[A-Z])%/g, (_, c) => keyLabel(c)) : s);
