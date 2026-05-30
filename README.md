# KTurtle

KTurtle is a TurtleScript programming environment for learning, experimenting, and drawing with code. It runs as a web app, a Windows/Linux desktop app, and an Android app from one shared React codebase.

Created by [Narek Balayan](https://t.me/narek1l).

[Try KTurtle online](https://kturtle.vercel.app/) | [Downloads](https://kturtle.vercel.app/#about) | [Latest release](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest)

## Features

- TurtleScript editor for writing and running drawing programs.
- Interactive canvas for visual feedback while learning code.
- Shared web, desktop, and Android implementation.
- Desktop builds powered by Tauri.
- Android build powered by Capacitor.
- Release assets for Windows, Linux, and Android.

## Install

### Web

Use KTurtle directly in your browser:

[kturtle.vercel.app](https://kturtle.vercel.app/)

### Windows

Download the latest Windows installer or portable executable from GitHub Releases:

- [KTurtle-x64-setup.exe](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-x64-setup.exe)
- [KTurtle-portable.exe](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-portable.exe)

### Linux

Install the latest AppImage with:

```bash
curl -fsSL https://kturtle-seven.vercel.app/_install.sh | bash
```

This installs KTurtle into `~/.local/bin` and registers a desktop entry.

You can also download the AppImage or Debian package manually:

- [KTurtle-linux-x86_64.AppImage](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-linux-x86_64.AppImage)
- [KTurtle-linux-amd64.deb](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-linux-amd64.deb)

### Android

Download and sideload the APK:

[KTurtle-release.apk](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-release.apk)

Android 8 or newer is recommended.

## Downloads

Pre-built binaries are available on the [Releases page](https://github.com/loriberdarmath-ctrl/kturtle/releases).

| Platform | File | Description |
| --- | --- | --- |
| Windows | `KTurtle-x64-setup.exe` | Installer |
| Windows | `KTurtle-portable.exe` | Portable executable |
| Linux | `KTurtle-linux-x86_64.AppImage` | AppImage package |
| Linux | `KTurtle-linux-amd64.deb` | Debian/Ubuntu package |
| Android | `KTurtle-release.apk` | Android APK |

## Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build for production:

```bash
npm run build
```

Build and run the Android app:

```bash
npm run android:build
```

For detailed setup and platform-specific build instructions, see [BUILD.md](./BUILD.md).

## Project Structure

```text
.
├── src/                  React app shared across all targets
├── public/               Static assets
├── src-tauri/            Tauri desktop shell
├── android/              Capacitor Android project
├── docs/                 Static landing and downloads page
├── scripts/              Installer and development scripts
├── .github/workflows/    Release and CI workflows
├── capacitor.config.json Android configuration
├── vite.config.ts        Vite build configuration
└── vercel.json           Vercel deployment configuration
```

## Release Process

Release builds are produced through GitHub Actions when version tags are pushed. Each release publishes stable asset names that always point to the latest version through GitHub's `releases/latest/download` URLs.

## License

See [LICENSE](./LICENSE).
