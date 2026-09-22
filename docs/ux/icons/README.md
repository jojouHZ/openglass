# Icons

One SVG file per icon — Lucide geometry on a 24px grid, ready to import into the frontend (e.g. as Vue components via `vite-plugin-svgr`, `unplugin-icons`, or a small `<Icon name>` wrapper).

## Conventions

All files share the same envelope — only the inner `<path>` content differs:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.25"
     stroke-linecap="round" stroke-linejoin="round">
```

- **stroke-width** `1.25` — our UI Kit stroke, thinner than Lucide's default 2
- **`currentColor`** — color always comes from CSS (`color:` on the parent)
- **sizes** — default 20px UI, 16px inline/meta, 14px bubble status; set via `width`/`height` or `.icon`/`.icon-sm` in `base.css`
- **`flame.svg` is the only filled icon** — `fill #e03131` + `stroke #181818`, per `design-tokens.md`

## Inventory

| File | Role |
|---|---|
| `arrow-left` | back |
| `arrow-up` | send |
| `bell` / `bell-off` | notifications / muted chat |
| `bookmark` | saved messages self-chat |
| `camera` | screenshot notice, avatar pick |
| `check` / `check-check` | sent / read receipts |
| `chevron-right` | settings rows, contact profile links |
| `circle-alert` | errors, reporting |
| `copy` | copy message / copy tag |
| `ellipsis-vertical` | more / message menu (centered under header title) |
| `flame` | burn / TTL — filled, the only non-stroke icon |
| `image` | image attachment |
| `loader` | sending state |
| `lock` | private indicators |
| `message-square` | empty states, chats nav |
| `monitor` / `smartphone` | session device rows |
| `paperclip` | attachment |
| `pencil` | edit |
| `phone` | call action |
| `pin` | pinned messages / pinned chats |
| `qr-code` | in-person device verification |
| `wifi-off` | offline banner |
| `plus` | add member / new chat |
| `reply` | reply action |
| `search` | search |
| `settings` | settings nav |
| `shield-check` | verified device |
| `timer` | session TTL countdown |
| `trash-2` | delete |
| `user` / `user-plus` / `users` | contacts / add member / group |
| `venetian-mask` | incognito / private identity |
| `x` | close / remove / discard |
