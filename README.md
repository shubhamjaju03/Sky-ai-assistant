# Sky AI — Multimodal Web, PWA, and Android Assistant

Sky AI is a free-first personal assistant for the web and Android. It starts
instantly without downloading an AI model and uses Gemini 3.1 Flash-Lite for
online responses. Conversation history, explicit memories, saved knowledge,
and reminders remain in the device's local storage.

## Live application

[Open Sky AI](https://sky-private-ai-shubham.shubhamjaju03.chatgpt.site/)

## Downloads

- [Download the latest Android debug APK](https://github.com/shubhamjaju03/Sky-ai-assistant/raw/refs/heads/main/releases/Sky-AI-latest-debug.apk)
- [Verify the APK checksum](releases/SHA256SUMS.txt)
- GitHub's **Code → Download ZIP** option contains the complete source project.

The APK is debug-signed for direct testing. Android may ask you to allow
installation from your browser or file manager.

## Features

- Online AI chat with no model download
- Live web research with linked sources
- Image, PDF, text, and code-file understanding
- Private device-local memories and knowledge library
- Voice input, spoken answers, and hands-free mode
- Android and browser reminders
- Calendar, maps, sharing, email-draft, website, clipboard, and text-file actions
- Encrypted backup and restore between devices
- Installable Progressive Web App with offline application shell
- Native Capacitor Android application
- Responsive interface with dedicated Sky branding, favicon, and assistant avatar

## Privacy and cost

- The Gemini API key is used only by the server worker and is never included in
  browser or Android bundles.
- `.env*`, dependency folders, generated builds, and temporary deployment files
  are excluded from Git.
- The app is designed to work with Gemini's free quota. If that quota is
  exhausted, AI requests wait until the quota resets; no paid subscription is
  required by the application itself.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
```

Copy `.env.example` to `.env.local` for local development, then replace the
placeholder value:

```text
GEMINI_API_KEY=your_gemini_api_key
```

Run locally:

```bash
npm run dev
```

Build and test:

```bash
npm test
```

## Android

Build the mobile web bundle, synchronize Capacitor, and create a debug APK:

```bash
npm run android:apk
```

The APK is generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Generated APKs and build caches are intentionally not committed because they
can be reproduced from the backed-up source. A tested APK snapshot is included
under `releases/` for convenient installation.

## Main project areas

- `app/` — responsive React interface and private local utilities
- `worker/` — Gemini API proxy, action validation, and live web research
- `public/` — PWA manifest, service worker, icons, avatar, and social images
- `mobile/` — Capacitor mobile entry point
- `android/` — native Android project
- `tests/` — server-rendering and backend behavior tests
