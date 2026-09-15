import { defineConfig } from "vite";

/**
 * Where the built site will be served from.
 *
 * GitHub Pages puts a project site under the repository name, so a page at
 * `/currents/` asking for `/assets/index.js` gets the owner's root site or a
 * 404 — a blank screen with nothing in the console to explain it. Every asset
 * this page references is root-relative, so this one value is what makes them
 * resolve.
 *
 * Derived rather than written down. A hardcoded `/currents/` breaks quietly the
 * moment the repository is renamed or forked, and the answer is already to
 * hand: the deploy workflow passes what GitHub itself reports the base to be,
 * and failing that the repository name is in the environment. Locally neither
 * is set and it falls through to the root, which is what `npm run dev` wants.
 */
function resolveBase(): string {
  const explicit = process.env.BASE_PATH;
  if (explicit) return normalise(explicit);

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository) {
    const [owner, name] = repository.split("/");
    // A repository named <owner>.github.io is served from the root; anything
    // else is a project site and lives one level down.
    if (owner && name && name.toLowerCase() !== `${owner.toLowerCase()}.github.io`) {
      return normalise(name);
    }
  }

  return "/";
}

/** Leading and trailing slash, whatever shape the value arrived in. */
function normalise(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

export default defineConfig({
  base: resolveBase(),
  server: {
    host: "127.0.0.1",
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
  },
});
