# MFE Private-Layer Event Bus

## Scope

This contract defines how the PWA shell host (`apps/pwa`) communicates with the
private-layer remote module (`@openglass/core/private`) without importing the
remote's internal Pinia store.

## Design principle

- The host must never read `usePrivateStore()` or any remote state.
- The remote owns all cryptography, session state, relay connection, and
  volatile messages.
- The host mounts remote UI components or subscribes to typed events carrying
  only UI-safe payloads.

## Remote-to-host events

The remote emits these events through a bus accessible to the host:

```ts
type PrivateHostEvent =
  | {
      type: "private:session-change";
      sessionId: string;
      peerId: string;
      status: "none" | "incoming" | "inviting" | "exchanging" | "unverified" | "verified" | "closed";
    }
  | {
      type: "private:new-message";
      sessionId: string;
      message: {
        id: string;
        fromMe: boolean;
        text: string;
        ts: number;
        viewOnce?: boolean;
      };
    }
  | {
      type: "private:message-removed";
      sessionId: string;
      messageId: string;
    }
  | {
      type: "private:burn";
      sessionId: string;
    }
  | {
      type: "private:error";
      sessionId?: string;
      code: "no-session" | "no-key" | "send-failed";
    };
```

The `text` field in `private:new-message` is already decrypted by the remote
and is safe to render. No key material crosses the bus.

## Host-to-remote events

The host emits these events to request remote actions:

```ts
type PrivateRemoteEvent =
  | { type: "private:start-invite"; peerId: string; ttlSeconds: number; strict: boolean }
  | { type: "private:accept-invite"; sessionId: string }
  | { type: "private:decline-invite"; sessionId: string }
  | { type: "private:confirm-sas"; sessionId: string }
  | { type: "private:send"; sessionId: string; text: string; viewOnce?: boolean }
  | { type: "private:burn"; sessionId: string };
```

## Host responsibilities

- Render the private chat chrome and navigation.
- Pass `chatId`/`peerId` and router hooks to the remote components.
- Listen for `private:session-change` to update the `private-toggle` badge and
  navigate between S10/S11/S11b/S12.
- Listen for `private:new-message` and `private:message-removed` to render the
  volatile message list.
- Handle `private:burn` by returning the user to the public chat (S5).

## Remote responsibilities

- Manage the WebSocket relay connection and IndexedDB identity keys.
- Encrypt, decrypt, and route opaque relay envelopes.
- Maintain volatile session state and emit UI events when it changes.
- Perform `send`, `accept`, `decline`, `confirm-sas`, and `burn` actions when
  the host requests them.

## Security notes

- The bus must never carry `sessionKey`, `identityKeyPair`, SAS material, or
  raw relay blobs.
- `private:new-message` text is plaintext after remote decryption and is safe
  for host rendering because the host already displays public messages.
- Receipts (`markDisplayed`) remain internal to the remote; the host does not
  learn message read state beyond UI visibility.

## Migration path

1. Introduce `PrivateEventBus` in `@openglass/core/private/bus`.
2. Make `usePrivateStore` internal to `@openglass/core`; do not export it from
   the public API.
3. Replace direct `usePrivateStore()` calls in `apps/pwa` with event-bus
   subscriptions or remote component mounts.
4. Keep `VITE_PRIVATE_MODULE=1` gating so the production PWA bundle never
   contains the private module.
