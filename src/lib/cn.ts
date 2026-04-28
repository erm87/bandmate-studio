/**
 * Tiny class-name joiner. Filters out falsy values so we can do:
 *   cn("base", isActive && "active", isDisabled && "opacity-50")
 *
 * Equivalent to a 5-line clsx — included inline to avoid an extra dep.
 */
export function cn(...args: Array<string | undefined | null | false>): string {
  return args.filter(Boolean).join(" ");
}
