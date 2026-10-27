// Preserve existing invitation URLs and the WebAuthn origin. Flutter owns the UI.
location.replace(new URL('./', location.href).href + location.hash);
