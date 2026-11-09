# Contributing

Thanks for helping! Bug reports, device test results and pull requests are all welcome.

## Reporting a problem

[Open an issue](https://github.com/Leisurp/Scrimba-Companion/issues/new/choose) and include:

- your phone model, Android or iOS version, and the app version (Settings → About);
- the lesson link, if it happens in a particular lesson;
- what you did, what you expected, and what happened instead.

A diagnostics report helps a lot: Settings → tap the version 7 times → Diagnostics → Export. It
contains no cookies, code or personal links; please look it over before attaching it.

Security problems: please don't open a public issue; see [SECURITY.md](SECURITY.md).

## Changing the code

See the [development guide](docs/DEVELOPMENT.md). Before opening a pull request:

```bash
npm run verify
```

```bash
npm run test:e2e
```

- If you change anything in `src/injected/`, run `npm run build:injected` and commit the
  regenerated bundle.
- Scrimba's site changes over time. Read [COMPATIBILITY_FINDINGS.md](docs/COMPATIBILITY_FINDINGS.md)
  before changing a compatibility module, and check the change with `npm run test:live` and, if
  you can, on a real phone.
- Keep the app's promises: no tracking, nothing sent anywhere, no reading of cookies or passwords,
  and the page script only runs on scrimba.com.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
