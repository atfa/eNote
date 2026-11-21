# Installing and launching on the device

`install.sh` is short; this file explains why each line is there.

## The apk must be readable by system_server

`pm install` hands the file to `system_server`, which runs with its own SELinux domain and
**cannot read `/data/data/com.termux/...`**. Copy the apk somewhere world-readable first:

```sh
su -c "cp $PWD/app.apk /data/local/tmp/com.example.myapp.apk && chmod 644 /data/local/tmp/com.example.myapp.apk"
su -c "pm install -r -g /data/local/tmp/com.example.myapp.apk"
```

`-g` grants all runtime permissions at install time, so a test never has to tap a dialog.
`-r` reinstalls over an existing copy.

## A verifier dialog can block `pm install` forever, even as root

On several OEM ROMs the package verifier intercepts installs - including root `pm install` -
and waits for a human: `pm install` prints nothing, never returns, and logcat shows
`Play Protect doesn't know this app` / `file:///data/app/vmdl...tmp`. The old escape hatch
`pm install --disable-verification` was removed in Android 16 (`Unknown option`).

`silent-install.sh` (run by `setup-toolchain.sh`, and by `install.sh` as a retry) turns the
verification path off with `settings put`:

```
global package_verifier_enable 0      global package_verifier_user_consent -1
global upload_apk_enabled 0           global verification_required 0
global verifier_verify_adb_installs 0 secure install_non_market_apps 1
```

Some ROMs do not know every key; each failure is reported and skipped. Re-run after a factory
reset. If installs still hang, install once by hand and watch which dialog appears.

## Without root

`pm install` from an app uid fails on Android 11+ (`SecurityException: uid ... does not have
permission android.permission.INSTALL_PACKAGES`), and `am`/`dumpsys`/`screencap` are shell-only.
The supported path is one tap:

```sh
termux-open app.apk        # opens the system installer; tap Install
```

`install.sh` does this automatically when it finds no root and exits 0. Everything after the
tap - launching with extras, reading logs, screenshots - needs root, so `test.sh` reports
"skipped" (exit 3) instead of pretending.

## Launching

```sh
su -c "am force-stop com.example.myapp"
su -c "input keyevent KEYCODE_HOME"            # Android 14+: a background shell cannot start activities
su -c "am start -n com.example.myapp/.MainActivity"
```

* Android 14+ refuses activity starts from a background shell. Pressing HOME first makes the
  launcher the foreground task, then the start is accepted.
* With an `android:exported="true"` launcher activity you can also start it directly from a
  Terminal session; `termux-open` cannot carry extras.
* Some vendors open shell-started activities in a small freeform window (observed modes like
  `mWindowingMode=vivofreeform`, `mLastNonFullscreenBounds=Rect(...)`) or, on tablets in a
  desktop mode, in a resizable window. Then `input tap` coordinates and the app's own view
  coordinates differ in both axes. Set `android:resizeableActivity="false"` and derive tap
  points from the geometry the app logs (`getLocationOnScreen`), never from a guess.

## Multiprofile devices

`pm list users` can show more than one user (work profile, second space, "dual messenger").
An install lands in the current user; an uninstall without `--user` can silently do nothing
there. When a package seems stuck:

```sh
su -c "pm list users"
su -c "pm uninstall --user 0 com.example.myapp"
su -c "pm install -r -g --user 0 /data/local/tmp/app.apk"
```

## Do not let root create the app's data directory

Never `mkdir` under `/data/data/<pkg>` or `/data/user/0/<pkg>`. If root creates it, the app
silently fails to write SharedPreferences (`commit()` returns false, nothing in logcat) and
`pm install -r` does not fix the owner. The only cure is uninstall + install.

Writing a *file* inside the app's existing `files/` directory is fine - it inherits the
directory's label - but it must be `chmod 644` or the app cannot read it, and the write has to
happen in the global mount namespace (next section).

## A shadow `/data/data`

On some root setups (observed with KernelSU) a plain `su -c "ls /data/data"` shows only a
sandboxed subset, and a file written that way never reaches the app - while
`su --mount-master -c "cat /data/data/<pkg>/files/x"` shows the real thing. Both reads *and*
writes of app-private files go through `asroot_global` (`lib/root.sh`), which uses
`--mount-master` when the su binary supports it. Symptoms of getting this wrong: the hook file
"exists" but the app never reacts; the app's log file appears empty.

Related: `run-as` fails on userdebug ROMs (`run-as: /data/user has wrong owner`), and
`/sdcard/Android/data/<pkg>` is not readable from Termux on Android 11+.
