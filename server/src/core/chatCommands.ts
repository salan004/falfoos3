/**
 * Shared chat-command utilities used by GameManager and every game.
 * Keeps command parsing in ONE place so games never re-implement it.
 */

/** Invisible/bidi control characters that leak into chat text (RTL/LTR marks, ZWSP, BOM). */
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

/**
 * Normalizes a chat message for command matching:
 * strips invisible direction marks, collapses whitespace, lowercases.
 */
export function normalizeChatCommand(raw: string): string {
  return raw
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The GLOBAL join command, accepted by every game:
 * !انضم (Arabic) or !join — tolerant to whitespace and invisible-char variations.
 */
export function isJoinCommand(normalizedText: string): boolean {
  return /^!\s*(انضم|join)$/.test(normalizedText);
}
