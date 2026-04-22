import { formatDistanceToNowStrict } from "date-fns";

export function relativeTime(date: string | null): string {
  if (!date) return "never";
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}
