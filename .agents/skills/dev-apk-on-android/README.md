# dev-apk-on-android

Build, sign, install and test **Android APKs on the phone itself**, from Termux. No PC, no
Android Studio, no Gradle, no Android SDK download. With root, the app under test can run on an
**invisible background display**, so debugging stops stealing the phone.

```
edit -> aapt2 -> javac -> d8(R8) -> zip -> apksigner -> pm install -> verify
```

This is an [Agent Skill](https://agentskills.io/specification): `SKILL.md` tells a coding agent
when and how to use the scripts, `references/` holds the detail (toolchain, install traps,
testing harness, pitfalls), and `vendor/` holds the toolchain itself.

## Requirements

* Termux (arm64 or armv7) with `pkg install openjdk-21 aapt2 aapt apksigner zip unzip python`
  - the only step that needs the network, and only once.
* Root (Magisk / KernelSU / sudo) is **optional**. With it, installs are silent and the app can
  be driven and verified from a script. Without it, everything still builds and signs, and
  installing is one tap in the system installer.

## Install the skill

```sh
git clone https://github.com/atfa/dev-apk-on-android ~/.agents/skills/dev-apk-on-android
# pi: also works under ~/.pi/agent/skills/ or a project's .agents/skills/
```

Then ask the agent for an Android app, or run the scripts yourself.

## Quick start

```sh
S=~/.agents/skills/dev-apk-on-android/scripts
sh $S/setup-toolchain.sh                                  # verifies vendor/, installs toolchain
sh $S/new-project.sh ~/apps/myapp com.example.myapp "My App"
cd ~/apps/myapp && ./build.sh && ./install.sh && ./test.sh

# with root: keep the phone while the app runs
sh $S/vd.sh create && sh $S/vd.sh launch com.example.myapp/.MainActivity
sh $S/vd.sh shot /tmp/app.png && sh $S/vd.sh tap 540 1200
# or: ./install.sh --bg, ./screen.sh --vd, ./test.sh --vd
```

The scaffold is self-contained: it carries its own copies of the scripts and `lib/`, so the
project keeps building even if the skill is moved.

## What is in here

```
SKILL.md                  the instructions an agent loads
references/build.md       toolchain: aapt2 / javac / d8 / sign, and the Termux JDK abort
references/install.md     staging, silent install, verifiers, launching, multiprofile
references/testing.md     hooks, the app's own log file, liveness, tap calibration
references/virtual-display.md  the invisible display: daemon, flags, rotation, input, screen-off
references/pitfalls.md    33 symptoms -> cause -> fix
references/vendor.md      the offline toolchain, adding an API level, new dexer
scripts/                  setup, new-project, build, install, test, probe, log, screen,
                          silent-install, wrap-termux-jdk, fix-termux-javac, dumpjni,
                          verify-vendor, selfcheck, vd, vd-build
lib/                      config.sh (all defaults) + root.sh (su/sudo/none abstraction)
templates/                manifest, Activity with test hooks, test.sh, icon + screenshot tools
vendor/                   android-33 android.jar + r8 (D8) + vd.jar + SHA256SUMS + MANIFEST.md
```

## Verify it works on your phone

```sh
sh scripts/verify-vendor.sh    # checksums, and a real D8 run - seconds
sh scripts/selfcheck.sh        # scaffold -> build -> install -> test -> uninstall
```

`selfcheck.sh` uses its own package name and cleans up after itself; without root it stops after
the build and says so.

## Design notes

* **API levels come from `app.env`**, not from the manifest: `build.sh` passes
  `--min-sdk-version` / `--target-sdk-version` to `aapt2 link`, so the two cannot drift.
* **No hidden downloads.** The two jars ship in `vendor/` and are checksum-verified; only
  `pkg install` touches the network.
* **Root is a capability, not a requirement.** Every script degrades with a message instead of
  failing when `su`/`sudo` is missing (`APK_NO_ROOT=1` forces that path for testing).
* **The invisible display is a daemon, not a setting.** `overlay_display_devices` needs no root
  but leaves a thumbnail on the panel and takes no flags; a root `app_process` daemon can pick
  the flags (`OWN_FOCUS`, `STEAL_TOP_FOCUS_DISABLED`) that keep your foreground untouched.
* **Assertions read the app's own log file**, because logcat is evicted by system noise on a
  busy phone.

## License

MIT - see `LICENSE`. The bundled binaries are Google's `android.jar` (Apache-2.0) and R8
(Apache-2.0); upstream urls and hashes are in `vendor/MANIFEST.md`.
