# Running the app on a display nobody can see

Debugging from Termux normally steals the phone: `am start` puts the app under test on the
panel, so a five-minute acceptance test means five minutes of the phone being unusable. With
root you can create a **virtual display** that nothing mirrors, run the app there, screenshot
it, inject touches into it, and keep using the phone for everything else.

Measured on Android 16 (vivo V2366HA, KernelSU, panel 1080x2400@480). Needs root; without it
every command says so and exits 3.

## Quick start

```sh
S=<this skill>/scripts
sh $S/vd.sh create                              # background display: 131 (1080x2400@440)
sh $S/vd.sh launch com.example.myapp/.MainActivity
sh $S/vd.sh shot /tmp/app.png                   # upright PNG of that display
sh $S/screen.sh --vd 60                         # the same, as ASCII art
sh $S/vd.sh tap 540 1200                        # pixels of the screenshot
sh $S/vd.sh status                              # who is focused where
sh $S/vd.sh destroy
```

In a scaffolded project the same thing is wired into the normal flow:

```sh
./install.sh --bg        # install and start on the background display
./screen.sh --vd 60      # look at it
./test.sh --vd           # run the acceptance test there - the panel stays yours
./vd.sh tap 540 1200
```

## How it works

`vendor/vd/Vd.java` is a ~300-line daemon compiled to `vendor/vd/vd.jar` (d8, `vd-build.sh`)
and started as root through `app_process`:

```sh
su -c "CLASSPATH=/data/local/tmp/vd.jar setsid app_process /system/bin \
       dev.apkdbg.Vd 1080 2400 440 /data/local/tmp/vd.cmd /data/local/tmp/vd.id \
       >> /data/local/tmp/vd.log 2>&1 &"
```

It calls `DisplayManager.createVirtualDisplay()`, feeds the surface from an `ImageReader`, and
answers commands written to a file (`"<seq> <op> [args]"`, seq must increase - the driver uses
`date +%s%N` because a per-process counter resets). Ops: `shot <path>`, `size`, `rotate <deg>`,
`power <state>`, `ping`, `quit`. `vd.sh` is the driver: it deploys the jar, starts the daemon,
writes commands, and polls the log/file for the result.

Four things cost hours and are baked in:

1. **`Looper.prepareMainLooper()` before `ActivityThread.systemMain().getSystemContext()`** -
   without a Looper the app_process hangs forever (exit 137 after `kill -9`).
2. **Flag values move between Android versions** (`TRUSTED` is `0x40` on 10-13, `0x400` on 16),
   so they are read from the framework by name at runtime. The set that works here:
   `PUBLIC|TRUSTED|OWN_CONTENT_ONLY|SUPPORTS_TOUCH|OWN_FOCUS|STEAL_TOP_FOCUS_DISABLED|
   SHOULD_SHOW_SYSTEM_DECORATIONS|ALWAYS_UNLOCKED|OWN_DISPLAY_GROUP|ROTATES_WITH_CONTENT|
   DESTROY_CONTENT_ON_REMOVAL` (`0x15fc9` on this build). `OWN_FOCUS` + `STEAL_TOP_FOCUS_DISABLED`
   are what keep your own foreground untouched; `DESTROY_CONTENT_ON_REMOVAL` is what stops the
   app from being thrown onto the user's panel when the display is released.
3. **A display in its own display group starts OFF** and an OFF display renders nothing
   (`ERR no frame`). The daemon therefore sets a power override at startup:
   `DisplayManager.setOverrideDisplayState(id, 2)`. `setVirtualDisplayState()` does **not**
   exist on Android 16 - the daemon probes `setOverrideDisplayState`, `setForceDisplayStateOn`,
   then `DisplayManagerGlobal.requestDisplayPower`.
4. **Capture must be copied under the lock** (`IllegalStateException: buffer is inaccessible`
   otherwise) and the PNG written to `.tmp` + renamed, or the driver reads a truncated file.

## Rotation

SurfaceFlinger renders into the display's **base** (natural) size: a landscape game on a
portrait 1080x2400 display is drawn rotated inside a 1080x2400 buffer. `Display.getRotation()`
returns 0 for it, so it is useless; the truth is the app window's transform in `dumpsys input`
(`transform (ROT_270)`). `vd.sh launch` reads it and tells the daemon to rotate shots the other
way, so the PNG comes out upright and **tap coordinates are screenshot pixels**:

| shot rotation | screenshot (X,Y) -> display (x,y) |
|---|---|
| 0 | `x=X y=Y` |
| -90 | `x=W-1-Y  y=X` (W = buffer width) |
| 90 | `x=Y  y=H-1-X` (H = buffer height) |
| 180 | `x=W-1-X  y=H-1-Y` |

`vd.sh size` prints what it is using: `screenshot: 2400x1080 display buffer: 1080x2400 rot=-90`.
Override manually with `vd.sh rotate <deg>` (0/90/180/270).

Measured on this device: a landscape game on a portrait display (`ROT_270` -> `rotate -90`) and a
portrait app (`ROT_0` -> `rotate 0`). The 90 and 180 cases use the same mapping table but have not
been exercised on hardware - if a shot comes out mirrored, that is the code path to check.

## Input

The display id comes from `vd.sh id`. The input source goes **before** `-d`:

```sh
su -c "input touchscreen -d 131 tap 580 1000"     # OK
su -c "input -d 131 touchscreen tap 580 1000"     # Unknown command: touchscreen
su -c "input keyevent -d 131 66"                 # KEYCODE_ENTER
su -c "input text -d 131 'hello'"
```

A tap that lands outside the app window's `touchableRegion` is dropped silently - check with
`su -c "dumpsys input"` and look under `Display: 131` for `touchableRegion=[0,0][1080,1080]`.
A window that is rotated also has rotated bounds, which is why the mapping table above matters.

## Focus, and the screen being off

`vd.sh status` (and `probe.sh`) print focus per display:

```
display 131: Window{... dev.xduo.plants/.MainActivity ...}   <-- target
display 0:   Window{... com.termux/.TermuxActivity ...}
```

The panel keeps showing whatever you had open; the app is foreground on its own display.

With the power override the display keeps rendering while the panel is off - measured: two
shots two seconds apart differ (`5f18214d…` vs `c4dbafe9…`) with the screen off, and are
identical (`2d8d5474…`) when the display is off. That is what makes `test.sh --vd` usable
overnight, with the screen dark and the battery barely touched.

## Creating the display: the device must be AWAKE

`setOverrideDisplayState(ON)` is accepted (`vd.sh log` prints `OK power 2 via …`) but the
**display only starts rendering if it was created while the device was awake**. Create it during
Doze and `dumpsys display` keeps saying `Display State=OFF` forever, the override is ignored, and
every shot is a black frame. So wake the panel first, then create, then launch:

```sh
su -c "input keyevent 224"          # KEYCODE_WAKEUP, may need it twice on this vivo ROM
su -c "wm dismiss-keyguard"         # taps are swallowed while isKeyguardShowing=true
su -c "input keyevent 82"           # menu, unlocks a swipe-free keyguard
sh $S/vd.sh create && sh $S/vd.sh launch com.example.myapp/.MainActivity
```

`vd.sh power [state]` re-applies the override (`vd.sh power 2`); use it after the panel fell
asleep, and check with `su -c "dumpsys display" | grep -A2 "Display Id=<id>"`.

## Driving the app on the background display

* **The nav-bar strip eats taps.** On a 1080x2400 VD the system gesture area covers roughly
  `y >= 2285`, so a bottom tab bar sits under it: tap the **upper** part of the tab
  (`y ~ 2250`), not its label. Symptom: the shot never changes and the taps land on the launcher.
* **`am start --display` does not move a running activity.** Force-stop first
  (`su -c "am force-stop <pkg>"`), then `vd.sh launch`, or the window stays where it was and you
  screenshot the old display.
* **`KEYCODE_BACK` (4) closes the app** and leaves `com.bbk.launcher2/.SecondaryDisplayLauncher`
  focused on the VD - every later shot is a blank wallpaper. Check focus with `probe.sh` before
  believing a screenshot.
* **The system status bar is not composited into VD shots.** A UI that must show the status bar
  (light/dark icon tint, insets) has to be verified with `dumpsys window windows | grep -E
  "fitsSystemWindows|systemUiVisibility"` plus a real panel screenshot, not with a VD shot.
* Termux has no writable `/tmp`: write shots under the project (`.test/shots/`).

## Fallback without a daemon: overlay displays

Android 10+ has a settings knob that creates an overlay display - no root daemon, but it shows
a **thumbnail on the panel** (the app itself is not on the panel, the thumbnail is):

```sh
settings put global overlay_display_devices "1080x2400/440"
settings put global overlay_display_devices none
```

On this Android 16 build no flag names are accepted after the size, so you cannot make it
untrusted/private. Use it when you cannot run a daemon (no root, SELinux blocks `app_process`);
`am start --display <id>` and `input -d <id>` work the same way.

## Lifecycle and defaults

* `create` with no argument uses the panel's own geometry (`wm size`, `wm density`), so the app
  gets the density it would get on the real screen - the layout is what you would see on the
  phone. Pass `WxH@dpi` to test other sizes: `vd.sh create 800x1280@320`.
* The daemon is started with `setsid` from a root shell, so it is reparented to init (measured:
  `PPID 1`). Killing Termux does not kill it; the display and the app on it keep running.
* Nothing is persisted: a reboot clears `/data/local/tmp` and the display with it. `vd.sh status`
  says "no background display" after a reboot, and `create` starts clean.
* `destroy` is idempotent, and `create` destroys any previous daemon first, so re-running it is
  always safe.

## Teardown

`vd.sh destroy` sends `quit`; the daemon's shutdown hook releases the display and deletes the
id file, and the daemon dies. Verify:

```sh
su -c "dumpsys display" | grep -c "Display Id=131"   # 0
su -c "pgrep -f dev.apkdbg.Vd"                        # empty
```

**The app dies with the display.** Without `DESTROY_CONTENT_ON_REMOVAL` the system *moves* the
tasks off a display that disappears, so releasing the display throws the app onto the user's
panel - measured: after `destroy`, display 0 went from `com.termux` to
`com.android.settings/.Settings` and the Bluetooth page popped up in front of the user. With
the flag set (it is), display 0 keeps its focus and nothing appears.

If the phone reboots, everything is gone by design - nothing is persisted, `/data/local/tmp`
is wiped on boot on most devices.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `daemon did not come up` | jar not staged, SELinux blocks `app_process` | `vd.sh log`; check `su -c "ls -l /data/local/tmp/vd.jar"` |
| `ERR no frame (is the display showing anything?)` | display power is OFF | look for `WARN power` in `vd.sh log`; the override needs `DEVICE_POWER` (root) |
| shot is sideways | app rotation not detected | `vd.sh rotate <deg>`; `vd.sh size` shows the current mapping |
| tap does nothing | outside `touchableRegion`, or the shot rotation is wrong | `dumpsys input` for the region; `vd.sh rotate` |
| `NO FRAME` after the first shot | command seq not monotonic | use `vd.sh`, which stamps `date +%s%N` |
| app opened on the panel | `am start` without `--display` | `vd.sh launch` (it passes `--display`) |
| the app pops onto the panel when you run `destroy` | the system moved it there when its display vanished | keep `DESTROY_CONTENT_ON_REMOVAL` in the flag set (it is on by default) |
| nothing renders with the screen off | power override missing | `vd.sh log`, look for `OK power 2 via …` |
| `Display State=OFF` forever, override returns OK | display created while the device was in doze | wake the panel (`input keyevent 224`), `vd.sh destroy && vd.sh create` |
| taps near the bottom do nothing, shot never changes | the system nav-bar/gesture area covers it | tap higher (on a 2400-tall VD, `y ~ 2250`), check focus with `probe.sh` |
| shots are a blank wallpaper | BACK closed the app, the launcher has focus on the VD | `vd.sh launch` again; avoid `vd.sh key 4` |
| app is on the panel, not the VD | `am start --display` on a running instance does not move it | `su -c "am force-stop <pkg>"` then `vd.sh launch` |
| status bar missing from shots | VD shots do not composite the system bars | verify with `dumpsys window windows`, not with a shot |

## Not covered

Audio routing (the app plays through the phone's speakers), secure windows (FLAG_SECURE content
comes out black), and multi-display DRM. Keyboard input goes through `input text`, not a
physical IME: the soft keyboard is not shown on the panel for a background display.
