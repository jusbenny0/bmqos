/** Enter in chat sends only on devices with a mouse; Shift+Enter and IME composition are left alone. */
export function sendsOnEnter(k: { key: string; shiftKey: boolean; isComposing: boolean }, inChat: boolean, finePointer: boolean): boolean {
  return k.key === "Enter" && !k.shiftKey && !k.isComposing && inChat && finePointer;
}
