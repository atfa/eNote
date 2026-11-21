# Driving and verifying the app from a shell

Tapping a screen you cannot see, and reading a log that the system keeps deleting, is the hard
part of on-device development. What works, in order of reliability:

1. the app writes its own state to `files/testlog.txt` (root reads it back),
2. the app exposes hooks that a shell can trigger,
3. `dumpsys` for "is it in the foreground",
4. `logcat` - a hint only,
5. `input tap` - last resort, needs calibration.

## App side: one log line, one hook

`templates/src/**/MainActivity.java` shows the pattern. Every notable event goes to logcat
*and* to the file:

```java
void note(String msg) {
    Log.i(TAG, msg);
    try (FileOutputStream f = new FileOutputStream(new File(getFilesDir(), "testlog.txt"), true)) {
        f.write((msg + "\n").getBytes("UTF-8"));
    } catch (Exception e) { /* ignore */ }
}
```

Log both **successes and refusals** (`prop: 3 busy phase=2`), so a test can retry instead of
reporting a dead button, and log **state**, not pixels (`state: screen=menu phase=2 fps=60`).

Two hooks, because one is not enough:

* intent extra - `am start -n pkg/.MainActivity --es hook ping` -> `hook: ping`.
  Only works for a cold start: Android 14+ drops the extras when the start just brings an
  existing task to the front (`Activity not started, its current task has been brought to the
  front`).
* hook file - write `files/testhook` with one `key=value` line, the app polls it and deletes
  it (one-shot). Works for a warm app, and is the fallback when activity starts are blocked.

The hook is only handled if the render loop runs, which needs a visible activity: wake the
screen first (`input keyevent KEYCODE_WAKEUP`, `svc power stayon true`) and keep it awake for
the duration of the test.

## Reading app data back

```sh
su --mount-master -c "cat /data/data/com.example.myapp/files/testlog.txt"
```

* Plain `su -c` can show a **shadow** `/data/data` (KernelSU): writes there never reach the
  app and reads show stale or empty content. Use the global namespace for app data, reads and
  writes - `asroot_global` in `lib/root.sh`.
* If root creates a file inside the app's `files/`, `chmod 644` it or the app cannot read it.
* Do not create the `files/` directory itself as root (see `install.md`).
* No root: none of this is readable. Keep the app's diagnostics on screen (or in a
  notification) and accept manual verification.

## Liveness

* `pidof` proves nothing: a finished activity leaves the process alive.
* `dumpsys window | grep mCurrentFocus` is the usual check, but under memory pressure
  `dumpsys` can return empty while the app is in front. Fall back to
  `dumpsys activity activities | grep mResumedActivity` (`probe.sh` does both).
* The best liveness signal is the app itself: "it answered a hook less than N seconds ago".
* The lowmemorykiller does kill games mid-run. Make the harness *restart and retry*
  (`ensure` helper) instead of failing the run, and keep the test sections re-runnable
  (`./test.sh props`) so a flaky check can be repeated in a loop.

## Harness patterns that survive this environment

```sh
readlog() { asroot_global "cat '$TLOG' 2>/dev/null" 2>/dev/null || true; }
waitfor() { n=0; while [ "$n" -lt "$2" ]; do readlog | grep -Eq "$1" && return 0; sleep 1; n=$((n+1)); done; return 1; }
```

* **Poll for the line, never sleep once.**
* **Clear the log after the action**, not before: every hook appends a state line, and a stale
  line would let the check pass without the action happening.
* `set -eu` plus `X=$(readlog | grep foo)` is a landmine: grep returning 1 kills the script.
  Append `|| true`.
* Logcat is not an assertion channel on many phones (MIUI, sensors, audio HAL flooding evicts
  your lines within seconds). `su -c "logcat -G 16M"` helps a little; the file is the channel.
* `dumpsys`, `screencap` and app data need root; `test.sh` exits 3 ("skipped") without it.

## Taps, when there is no other way

Canvas UIs have no view hierarchy to query, so a tap test must be driven by geometry the app
itself logs:

* log `layout: view=x,y WxH win=x,y` from `getLocationOnScreen()` and add that offset to every
  tap - the status bar / gesture area is not a constant offset (immersive mode, peeking bars,
  freeform windows all change it);
* log the hit the app received (`touch: down x,y spot=100`) and confirm each tap by that line,
  repeating the tap if the app never saw it (peeking system bars can swallow one);
* a drawn button that was never added to the hotspot list swallows taps silently - drive at
  least one real `input tap` per button and assert the activation line;
* handle BACK in the Activity (`onKeyDown`/`onBackPressed`), not in a SurfaceView: it is not
  focusable by default, so the key never arrives and the activity silently finishes.

## What "PASS" must mean

`test.sh` in a project should prove behaviour, not that a process exists: install clean, start
with a hook, assert the hook line, assert a state line, assert the app is still in the
foreground, and delete nothing that a later run needs. The worked example is a Canvas game
whose test installs, plays via hooks, taps real buttons, presses BACK, and reads the save file
back after a restart - that is the level a regression test has to reach to be worth running.
