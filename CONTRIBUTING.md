# Contributing

Thanks for your interest in VerDrive! Bug reports, suggestions and pull requests are welcome. The app is meant to stay simple, so please open an issue to discuss larger features before writing code.

Reports from real drives are especially useful: what the app showed, what the car's own trip computer or a full-tank measurement said, and the vehicle type and fuel. If you attach an exported trip log, check it first: it contains speeds, altitudes and times, but never your position.

## License of contributions

VerDrive is released under the [PolyForm Noncommercial License 1.0.0](LICENSE) and the author also offers separate commercial licenses.

By submitting a contribution (pull request, patch or any other code, text or asset), you agree that:

1. you wrote it yourself, or you have the right to submit it, and it does not include code or assets under terms that conflict with this project's license;
2. you license it to the project under the same PolyForm Noncommercial License 1.0.0;
3. you also grant the project author (Marco Pascucci) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, modify, sublicense and relicense your contribution, including under commercial or different license terms.

If you are not comfortable with this, please do not submit code, but feel free to open an issue instead.

## Third-party material

- The app has no third-party code dependencies and no build step, and we'd like to keep it that way. Please do not add libraries or tooling without discussing it first.
- Any new image, font or data table must come with its source and license, which must allow redistribution and non-commercial use. Add it to [app/CREDITS.md](app/CREDITS.md) in the same pull request.
- Do not copy code from projects whose license is incompatible with this one (for example GPL code).

## Running and testing

- Tests: `node --test` from the project root (Node 20 or later). All tests must pass.
- To try the app, serve the `app/` folder with any static server, for example `python3 -m http.server` from inside `app/`, and open it in a browser. The GPS needs `localhost` or HTTPS; to test on a phone, serve it over HTTPS.
- The service worker caches the app. While developing, disable it in the browser's developer tools or you may see an old version.

## The physics model

- The model is described for readers in [MODEL.md](MODEL.md). A change to the physics, a constant or a filter should update it in the same pull request.
- Every constant needs a source or a stated reason (a regulation, a measurement, a published figure, or "rough guess, to be tuned"). Put it in a comment next to the constant.
- New model functions are pure (no DOM, no storage) and come with tests in the matching `*.test.js` file.
- Estimates must stay honest: when the model leaves something out, say so in `MODEL.md` rather than hiding it in a fitted constant.

## Practicalities

- **Offline:** a new file in `app/` must be listed in `PRECACHE` in `app/sw.js` and in `WATCHED` in `app/update.js` (the version id is a hash of the watched files; there is no version number to bump).
- **Privacy:** settings and trip logs stay on the device. No tracking, no analytics, no external requests. The position never leaves `app/gps.js`: only speed, accuracy and altitude are passed on, and trip logs never contain coordinates.
- **Languages:** the app is in English and Italian. Every text shown on screen goes through `app/i18n.js` and needs both languages (a test checks that no Italian text is missing).
- **Number fields:** they are text fields with a decimal keypad. Read them with `parseDecimal` from `app/i18n.js`, which accepts both "." and "," as the decimal separator, and write them with `numText`.
- **Personal data:** never commit exported trip logs (`logs/` is ignored for this reason).
