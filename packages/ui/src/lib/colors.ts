export function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

export const LOCAL_GROUP_COLOR = "hsl(240, 7%, 40%)";

/** 12 distinct Catppuccin Mocha colors for session-edge color coding */
export const SESSION_COLORS = [
  "#89b4fa", // blue
  "#a6e3a1", // green
  "#fab387", // peach
  "#cba6f7", // mauve
  "#94e2d5", // teal
  "#f9e2af", // yellow
  "#f5c2e7", // pink
  "#74c7ec", // sapphire
  "#eba0ac", // maroon
  "#89dcfe", // sky
  "#b4befe", // lavender
  "#f2cdcd", // flamingo
];

export function sessionColor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = sessionId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx =
    ((hash % SESSION_COLORS.length) + SESSION_COLORS.length) %
    SESSION_COLORS.length;
  return SESSION_COLORS[idx];
}
