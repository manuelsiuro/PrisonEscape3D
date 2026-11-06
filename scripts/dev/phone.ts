// Dev tool, run by node (npx tsx scripts/dev/phone.ts <command>): the game on a real Android phone on USB,
// the dev server's game opened in its Chrome, code run in that tab, its screen taken and real touches
// sent (the `real-phone` skill says when and how; built 2026-11-06 on a Galaxy S24).
//   setup [path]              the phone checked, port 5310 reversed to it, its screen kept on, Chrome opened
//                             on http://localhost:5310/<path> (default "?perf"), Chrome's debugger forwarded
//   eval <file.js> | -e <js>  the body of an async function run in the game's tab; its JSON printed.
//                             `real(path)` is there to import a module by its real URL (after a hot reload
//                             the game's copy is `?t=…`): `const { view } = await import(real('/src/play/context.ts'))`
//   shot <file.png>           the phone's screen
//   tap <x> <y>               a real touch at a point of the page, in CSS pixels (getBoundingClientRect's)
//   tapEl <selector>          a real touch on an element's middle; tapText <text>: on the smallest button showing it
//   swipe <x1> <y1> <x2> <y2> [ms]   a real drag, page CSS pixels (a walk: the joystick, the reading card…)
//   clear                     Chrome's install sheet closed if it's up (setup and tapEl/tapText do it)
//   cleanup                   the screen's timeout back, the forwards removed
// The page's place on the screen (under Chrome's bar) is measured once by a touch the game never sees,
// then kept in the system's temp folder for that tab and size.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 5310;
const DEBUG = 9333;
const GAME = `http://localhost:${PORT}`;

const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8' }).trim();

/** The one phone on USB (or an error saying what's wrong). */
function phone(): string {
  const lines = adb('devices')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim());
  const ready = lines.filter((l) => l.endsWith('\tdevice'));
  if (ready.length !== 1)
    throw new Error(`phone: want one phone on USB with debugging allowed, adb sees ${lines.length ? lines.join('; ') : 'none'}`);
  return ready[0].split('\t')[0];
}

/** The game's tab in the phone's Chrome (other tabs, the user's, are never touched). */
async function gameTab(): Promise<{ id: string; url: string; ws: string }> {
  const res = await fetch(`http://localhost:${DEBUG}/json`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res) throw new Error(`phone: Chrome's debugger isn't forwarded (run setup; Chrome must be open on the phone)`);
  const tabs = (await res.json()) as Array<{ id: string; url: string; type: string; webSocketDebuggerUrl: string }>;
  const tab = tabs.find((t) => t.type === 'page' && t.url.startsWith(GAME));
  if (!tab) throw new Error(`phone: no tab on ${GAME} (run setup)`);
  return { id: tab.id, url: tab.url, ws: tab.webSocketDebuggerUrl };
}

/** Runs `body` (an async function's body) in the game's tab; its value, as JSON. Given up after `ms` (a tab in the background may never answer). */
async function run(body: string, ms = 600_000): Promise<unknown> {
  const tab = await gameTab();
  const prelude = `const real = (path) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(path)) ?? path;`;
  return new Promise((done, fail) => {
    const ws = new WebSocket(tab.ws);
    const late = setTimeout(() => {
      ws.close();
      fail(new Error(`phone: the game's tab didn't answer in ${ms / 1000} s (is Chrome in front, the screen on?)`));
    }, ms);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: `(async () => { ${prelude}\n${body}\n})()`, awaitPromise: true, returnByValue: true, timeout: 590_000 },
        }),
      );
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data)) as {
        id: number;
        result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
      };
      if (d.id !== 1) return;
      clearTimeout(late);
      ws.close();
      const err = d.result?.exceptionDetails;
      if (err) fail(new Error(err.exception?.description ?? err.text ?? 'exception'));
      else done(d.result?.result?.value);
    };
    ws.onerror = () => {
      clearTimeout(late);
      fail(new Error('phone: the debugger connection failed'));
    };
  });
}

/**
 * Chrome's own panel over the page (its install sheet, from the game being installable: it opens over
 * the bottom of the page and takes the touches meant for it), closed with Back while it's up. Read from
 * the phone's UI tree (a second or two): done by setup and before a tap aimed at an element; `tap` and
 * `swipe` skip it, for timed sequences.
 */
function clearChrome() {
  for (let k = 0; k < 3; k++) {
    execFileSync('adb', ['shell', 'uiautomator', 'dump', '/sdcard/pe3d-ui.xml'], { stdio: 'ignore' });
    if (!adb('shell', 'cat', '/sdcard/pe3d-ui.xml').includes('com.android.chrome:id/bottom_sheet')) return;
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    execFileSync('sleep', ['0.6']);
  }
}

/** The screen's size in device pixels (an override if one is set). */
function screenSize(): [number, number] {
  // (As the screen is turned: `wm size` says it upright whatever the rotation, and a tap at its "middle"
  // missed the screen turned on its side, session 8.)
  const cur = /\bcur=(\d+)x(\d+)/.exec(adb('shell', 'dumpsys', 'window', 'displays'));
  if (cur) return [Number(cur[1]), Number(cur[2])];
  const m = /(\d+)x(\d+)\s*$/.exec(adb('shell', 'wm', 'size'));
  if (!m) throw new Error('phone: no screen size');
  return [Number(m[1]), Number(m[2])];
}

/** The page's place: its pixels a CSS pixel, its offset on the screen, its size (touches outside it are refused). */
type Place = { dpr: number; dx: number; dy: number; w: number; h: number };

/**
 * Where the page sits on the screen: a touch at the screen's middle, caught before the game sees it
 * (a listener on the window, capturing, stopping it), says which page point that is.
 */
async function place(): Promise<Place> {
  const tab = await gameTab();
  const size = (await run('return [innerWidth, innerHeight, devicePixelRatio];')) as [number, number, number];
  const file = join(tmpdir(), `pe3d-phone2-${tab.id}-${size.join('x')}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Place;
  await run(`
    const kinds = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'click'];
    window.__phonePlace = new Promise((done) => {
      const stop = (e) => {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
        if (e.type === 'pointerdown') done([e.clientX, e.clientY]);
      };
      for (const k of kinds) addEventListener(k, stop, { capture: true, passive: false });
      setTimeout(() => { for (const k of kinds) removeEventListener(k, stop, { capture: true }); }, 1500);
    });
    return 1;`);
  const [w, h] = screenSize();
  chromeInFront();
  adb('shell', 'input', 'tap', String(Math.round(w / 2)), String(Math.round(h / 2)));
  // (Not waited on for ever: a touch that never reaches the page fails here, in seconds.)
  const got = (await run('return await Promise.race([window.__phonePlace, new Promise((r) => setTimeout(() => r(null), 3000))]);')) as
    [number, number] | null;
  if (!got) throw new Error("phone: the touch at the screen's middle never reached the page (a sheet over it? another app?)");
  const [cx, cy] = got;
  const dpr = size[2];
  const at: Place = { dpr, dx: w / 2 / dpr - cx, dy: h / 2 / dpr - cy, w: size[0], h: size[1] };
  writeFileSync(file, JSON.stringify(at));
  // (Let the catching listeners go before a real touch.)
  await new Promise((r) => setTimeout(r, 1600));
  return at;
}

/** Every touch first: Chrome must be the app in front, or the touch would land in another app of the user's. */
function chromeInFront() {
  const focus = /mCurrentFocus=.*/.exec(adb('shell', 'dumpsys', 'window'))?.[0] ?? '';
  if (!focus.includes('com.android.chrome'))
    throw new Error(`phone: Chrome isn't in front (${focus.replace(/^.*u0 /, '').replace(/}$/, '')}): no touch sent; run setup again`);
}

/**
 * A page point on the screen, in device pixels. Refused off the page: a touch there lands on Chrome's bar
 * or Android's (Back left Chrome for another app on the user's phone once, 2026-11-06).
 */
function onScreen(p: Place, x: number, y: number): string[] {
  chromeInFront();
  if (!(x >= 0 && y >= 0 && x < p.w && y < p.h))
    throw new Error(
      `phone: (${Math.round(x)}, ${Math.round(y)}) is off the page (${p.w}×${p.h}): refused, it would touch Chrome or Android`,
    );
  return [Math.round((x + p.dx) * p.dpr), Math.round((y + p.dy) * p.dpr)].map(String);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'setup': {
      const id = phone();
      adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
      adb('shell', 'svc', 'power', 'stayon', 'usb');
      const url = `${GAME}/${args[0] ?? '?perf'}`;
      adb(
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-n',
        'com.android.chrome/com.google.android.apps.chrome.Main',
        '-d',
        url,
      );
      adb('forward', `tcp:${DEBUG}`, 'localabstract:chrome_devtools_remote');
      const model = adb('shell', 'getprop', 'ro.product.model');
      let tab = null;
      for (let k = 0; k < 20 && !tab; k++) {
        await new Promise((r) => setTimeout(r, 500));
        tab = await gameTab().catch(() => null);
      }
      // (Older game tabs closed, so the one measured is the one on screen; the user's other tabs never touched.)
      if (tab) {
        const all = (await (await fetch(`http://localhost:${DEBUG}/json`)).json()) as Array<{ id: string; url: string; type: string }>;
        for (const t of all)
          if (t.type === 'page' && t.url.startsWith(GAME) && t.id !== tab.id) await fetch(`http://localhost:${DEBUG}/json/close/${t.id}`);
      }
      clearChrome();
      console.log(
        JSON.stringify({ phone: id, model, android: adb('shell', 'getprop', 'ro.build.version.release'), url, tab: tab?.id ?? 'not yet' }),
      );
      return;
    }
    case 'eval': {
      const body = args[0] === '-e' ? args.slice(1).join(' ') : readFileSync(args[0], 'utf8');
      console.log(JSON.stringify(await run(body), null, 1));
      return;
    }
    case 'shot': {
      if (!args[0]) throw new Error('phone: shot <file.png>');
      writeFileSync(args[0], execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
      console.log(args[0]);
      return;
    }
    case 'tap': {
      chromeInFront();
      const p = await place();
      adb('shell', 'input', 'tap', ...onScreen(p, Number(args[0]), Number(args[1])));
      return;
    }
    case 'tapEl':
    case 'tapText': {
      chromeInFront();
      // (By text: the smallest button, link or [role=button] showing it, as a player would find it.)
      const find =
        cmd === 'tapEl'
          ? `const e = document.querySelector(${JSON.stringify(args[0])});`
          : `const want = ${JSON.stringify(args.join(' '))};
             const area = (x) => { const b = x.getBoundingClientRect(); return b.width * b.height || Infinity; };
             const e = [...document.querySelectorAll('button, a, [role=button], label')].filter((x) => x.textContent.includes(want) && area(x) < Infinity).sort((a, b) => area(a) - area(b))[0];`;
      // Scrolled into view first (a menu or a card that scrolls), then refused if something covers it.
      const r = (await run(
        `${find} if (!e) return null;
         e.scrollIntoView({ block: 'center', inline: 'center' });
         await new Promise((r) => setTimeout(r, 300));
         const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
         const top = document.elementFromPoint(x, y);
         if (top && top !== e && !e.contains(top)) return { covered: top.className || top.tagName };
         return [x, y];`,
      )) as [number, number] | { covered: string } | null;
      if (!r) throw new Error(`phone: nothing on the page matches ${args.join(' ')}`);
      if (!Array.isArray(r)) throw new Error(`phone: ${args.join(' ')} is under something else (${r.covered}): not touched`);
      clearChrome();
      const p = await place();
      adb('shell', 'input', 'tap', ...onScreen(p, r[0], r[1]));
      console.log(JSON.stringify({ tapped: args.join(' '), at: r.map(Math.round) }));
      return;
    }
    case 'swipe': {
      chromeInFront();
      const [x1, y1, x2, y2, ms = '400'] = args;
      const p = await place();
      adb('shell', 'input', 'swipe', ...onScreen(p, Number(x1), Number(y1)), ...onScreen(p, Number(x2), Number(y2)), ms);
      return;
    }
    case 'clear':
      clearChrome();
      return;
    case 'cleanup': {
      phone();
      adb('shell', 'svc', 'power', 'stayon', 'false');
      execFileSync('adb', ['reverse', '--remove', `tcp:${PORT}`], { stdio: 'ignore' });
      execFileSync('adb', ['forward', '--remove', `tcp:${DEBUG}`], { stdio: 'ignore' });
      console.log('the screen times out again; the forwards are removed');
      return;
    }
    default:
      console.log(
        'phone.ts setup [path] | eval <file.js> | eval -e <js> | shot <file.png> | tap <x> <y> | tapEl <selector> | tapText <text> | swipe <x1> <y1> <x2> <y2> [ms] | clear | cleanup',
      );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
