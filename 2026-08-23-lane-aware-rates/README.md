Proof-of-work shots for PR #168 (lane-aware rates).

Captured from the app running locally on this branch, against a throwaway
Postgres sandbox (docker, synthetic accounts - no production data was read or
written; the prod proxy port was closed throughout). Every `*-before-*` shot
comes from this branch's merge-base, 31c6d23, so a pair shows this PR's diff and
nothing master did meanwhile.

`rateMode: elevated` is real, not painted: a local stub served the engine's
GET /metrics/agent-lanes with the subscription lane failing, and the site derived
the rate from it through the normal code path.

Sizes: 1440 desktop, 390 mobile.
