# nir-wave4-ux E2E

30 headless checks against a local stack (site + engine + db proxy) started from the
engine checkout with `SHAPELESS_SITE_DIR=<site worktree> npm run up -- --dev-account --no-open`.

Run it with the engine checkout's Playwright:

    ln -s ~/Dev/saas/ShapelessAI-Master/shapeless-ai-content/node_modules node_modules
    OUT=./shots node wave4.mjs

`results.json` is the run that produced the screenshots in the parent folder.

Nothing here spends money and nothing opens a window. The only faked values are API
payloads for rows the seeded dev account does not have (one connection, one finished
run); every page, component, route and signal is the real one. Media keys belong to
the local dev account 11111111-1111-4111-8111-111111111111.
