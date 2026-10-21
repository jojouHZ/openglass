// Mock data shaped exactly like the backend contract (schema.gen.ts):
// User{displayName,tag}, ChatSummary{type,title,peer,lastMessage,unreadCount,
// memberCount,pinned}, Message{text,attachments[photo|file],replyToMessageId,
// editedAt,pinned}, GroupMember{role,rights}, DeviceSession.
export const me = { displayName: "Alice", tag: "alice#3454" };
export const users = {
  carol: { displayName: "Carol", tag: "carol#3785" },
  bob: { displayName: "Bob", tag: "bob#4031" },
  dima: { displayName: "Dima", tag: "dima#5150" },
  anna: { displayName: "Anna", tag: "anna#2207" },
};
export const chats = [
  { type: "group", title: "ops room", memberCount: 4, pinned: true, unread: 3, who: "Carol", text: "Deploy window moved to 18:00", time: "12:44" },
  { type: "direct", title: "Carol", peer: users.carol, own: true, state: "read", text: "see you there", time: "11:20" },
  { type: "direct", title: "Bob", peer: users.bob, typing: true, time: "10:02" },
  { type: "group", title: "ops2", memberCount: 7, att: "runbook.pdf", who: "Dima", time: "Mon" },
  { type: "direct", title: "Dima", peer: users.dima, unread: 1, att: "photo", time: "Sun" },
  { type: "saved", title: "Saved messages", text: "invite codes for Friday", time: "Oct 16" },
];
export const msgs = [
  { sep: "Today" },
  { from: users.carol, text: "Deploy window moved to 18:00", time: "12:44", pinned: true },
  { from: users.dima, text: "Works for me. Staging first?", time: "12:46", reply: { who: "Carol", text: "Deploy window moved to 18:00" } },
  { own: true, text: "Yes — staging at 17:00, prod at 18:00", time: "12:48", state: "read" },
  { from: users.carol, photo: { name: "topology.png", size: "214 KB" }, time: "12:51" },
  { own: true, file: { name: "runbook.pdf", size: "1.2 MB" }, text: "Updated rollback steps", edited: true, time: "12:55", state: "sent" },
];
export const members = [
  { u: me, role: "owner" },
  { u: users.carol, role: "member", rights: ["invite", "pin"] },
  { u: users.dima, role: "member", rights: ["pin", "delete"] },
  { u: users.anna, role: "member", rights: [] },
];
export const rightLabels = { invite: "invite", pin: "pin", delete: "delete", edit: "edit info", remove: "remove" };
