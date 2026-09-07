# Site speed wave, 2026-09-07 (site PR: studio client cache + loading skeletons)

Rail walk measured with tools/probe-nav.mjs (Playwright, forged e2e session, warm dev server).
paintMs = click until the destination heading is on screen. api = /api requests fired by that navigation.

Before (master-shaped stack, :3103)              After (branch, prod build, :3308)
click /studio/accounts   820 ms  12 api          51 ms  0 api
click /studio/agents     312 ms  10 api          47 ms  0 api
click /studio/performance 315 ms 18 api          40 ms  0 api
click /brain            1314 ms   8 api          58 ms  2 api
second lap (return to each screen)
click /studio/posts      116 ms  12 api          42 ms  0 api
click /studio/accounts   820 ms  12 api          39 ms  2 api
click /studio/agents     312 ms  10 api          41 ms  2 api
click /studio/performance 315 ms 18 api          43 ms  4 api (metrics refresh POST is deliberate)
click /brain            1314 ms   8 api          42 ms  0 api

/pricing: prerendered (build table ○), Cache-Control: s-maxage=31536000, x-nextjs-prerender: 1.
