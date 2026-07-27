# Sky AI — Web, PWA, and Android

Sky AI is a free-first personal assistant that runs a compact language model
inside supported browsers with WebGPU. Conversation history and explicit
memories remain in the device's local storage.

## Included targets

- Hosted responsive web application
- Installable Progressive Web App (PWA)
- Capacitor Android application

## Main features

- Private on-device chat with streaming responses
- Persistent local conversations and opt-in memories
- Voice dictation and speech playback
- Local text-file attachments
- Calculator and current-time shortcuts
- Conversation export
- Install prompt and offline application shell

## Development

```bash
npm install
npm run dev
```

The first AI setup downloads `Qwen3-0.6B-q4f16_1-MLC` to the browser cache.
WebGPU is required for model inference.

## Android

```bash
npm run android:apk
```

The resulting debug-signed APK is created under
`android/app/build/outputs/apk/debug/`.
