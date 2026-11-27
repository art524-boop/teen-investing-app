// Must match AVATARS in supabase/functions/_shared/common.ts
export const AVATARS = [
  { key: 'koala', emoji: '🐨', label: 'Koala', bg: '#e6efe9' },
  { key: 'kangaroo', emoji: '🦘', label: 'Kangaroo', bg: '#f6e7d4' },
  { key: 'turtle', emoji: '🐢', label: 'Turtle', bg: '#dcf3e4' },
  { key: 'owl', emoji: '🦉', label: 'Owl', bg: '#efe4c4' },
  { key: 'dolphin', emoji: '🐬', label: 'Dolphin', bg: '#e7f5fb' },
  { key: 'fox', emoji: '🦊', label: 'Fox', bg: '#fde9dc' },
  { key: 'frog', emoji: '🐸', label: 'Frog', bg: '#e4f4d9' },
  { key: 'sunflower', emoji: '🌻', label: 'Sunflower', bg: '#fff1c7' },
] as const

export type AvatarKey = (typeof AVATARS)[number]['key']

export function avatarFor(key: string) {
  return AVATARS.find((a) => a.key === key) ?? AVATARS[0]
}

/** Same rule as the server: no all-same-digit PINs or straight runs. */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true
  return ['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210'].includes(pin)
}
