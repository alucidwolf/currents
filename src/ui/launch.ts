/**
 * What the URL fragment asks for.
 *
 * There is no start screen any more — the page drops you straight into the
 * water — so all that is left of "how did we arrive here" is these two
 * questions about the link that was opened.
 */

/** True when the page was opened as an unattended ambient display. */
export function isAmbientMode(hash: string = location.hash): boolean {
  return /(?:^|[#&])ambient(?:&|=|$)/.test(hash);
}

/**
 * An explicitly requested animal, from `#species=manta`.
 *
 * Lets a particular animal be linked directly. Without one the page deals a
 * random animal, and the current one is written back here as you swap, so a
 * reload keeps whichever you are being.
 */
export function requestedSpecies(hash: string = location.hash): string | null {
  return /(?:^|[#&])species=([a-z]+)/i.exec(hash)?.[1]?.toLowerCase() ?? null;
}
