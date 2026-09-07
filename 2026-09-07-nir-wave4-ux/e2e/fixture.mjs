// Fixture data for the nir-wave4-ux E2E run. Every media key below belongs to
// the seeded local dev account (11111111-...), never a customer.
const ACC = "11111111-1111-4111-8111-111111111111";
const asset = (name) => `/api/media/workspace-assets/${ACC}/${name}`;
const POSTER = `workspace-assets/${ACC}/kit-post-template-latency-canvas.jpg`;
const POSTER2 = `workspace-assets/${ACC}/kit-brand-card-instant-plain-receipts.jpg`;
const POSTER3 = `workspace-assets/${ACC}/kit-x-profile-header-green-wedge.jpg`;

const AT = "2026-09-07T09:00:00.000Z";
const art = (o) => ({
  blockId: "b1",
  mediaType: "video/mp4",
  createdAt: AT,
  ...o,
});

export const CONVERSATION_ID = "e2e-wave4-shelf";

export const SHELF_ARTIFACTS = [
  // An earlier take of the SAME aspect, produced first: superseded by the one
  // below, so it belongs on the shelf.
  art({
    id: "a-video-earlier",
    type: "video",
    capability: "video-editing",
    url: asset("daily-brief-2026-07-27-3.mp4"),
    width: 1080,
    height: 1920,
    durationSeconds: 30,
    meta: { aspect: "9:16", posterKey: POSTER2, title: "Launch short - take 1" },
  }),
  // The payoff: newest 9:16 render. Drawn above the shelf, never on it.
  art({
    id: "a-video-final",
    type: "video",
    capability: "video-editing",
    url: asset("daily-brief-2026-07-28.mp4"),
    width: 1080,
    height: 1920,
    durationSeconds: 32,
    meta: { aspect: "9:16", posterKey: POSTER, title: "Launch short - take 2" },
  }),
  art({
    id: "a-spec",
    type: "video-spec",
    capability: "video-editing",
    mediaType: "application/json",
    text: '{"scenes":[]}',
    meta: { aspect: "9:16", title: "Shot list v1" },
  }),
  art({
    id: "a-clip-1",
    type: "stock-clip",
    capability: "stock-footage",
    url: asset("daily-brief-2026-07-28-2.mp4"),
    width: 1080,
    height: 1920,
    meta: { posterKey: POSTER, title: "City at dusk", source: "Pexels" },
  }),
  art({
    id: "a-clip-2",
    type: "stock-clip",
    capability: "stock-footage",
    url: asset("daily-brief-2026-07-28-3.mp4"),
    width: 1080,
    height: 1920,
    meta: { posterKey: POSTER2, title: "Desk close-up", source: "Pexels" },
  }),
  art({
    id: "a-clip-3",
    type: "stock-clip",
    capability: "stock-footage",
    url: asset("daily-brief-2026-07-28-4.mp4"),
    width: 1080,
    height: 1920,
    meta: { posterKey: POSTER3, title: "Keyboard macro", source: "Pexels" },
  }),
  art({
    id: "a-voiceover",
    type: "voiceover",
    capability: "text-to-speech",
    mediaType: "audio/mpeg",
    url: asset("daily-brief-2026-07-27-5.m4a"),
    durationSeconds: 34,
    meta: { title: "Narration" },
  }),
  art({
    id: "a-captions",
    type: "caption-track",
    capability: "captioning",
    mediaType: "text/plain",
    text: "00:00 We shipped it in a weekend.\n00:03 Here is what that actually took.\n00:07 Three things nobody tells you.",
    meta: { title: "Captions" },
  }),
  art({
    id: "a-script",
    type: "script",
    capability: "trend-research",
    mediaType: "text/markdown",
    text: "Hook: we shipped it in a weekend.\n\nBeat 1: the thing everyone gets wrong about launch week.\nBeat 2: what we cut, and why.\nBeat 3: the number that changed our mind.\n\nClose: the link is in the caption.",
    meta: { title: "Script v2" },
  }),
  art({
    id: "a-image",
    type: "image",
    capability: "image-generation",
    mediaType: "image/jpeg",
    url: `/api/media/studio/${ACC}/studio-brand-interview-2026-08-04T08-14-13-879Z/brand-card-three-words.jpg`,
    width: 1080,
    height: 1080,
    meta: { title: "Brand card", aspect: "1:1" },
  }),
  art({
    id: "a-receipt",
    type: "publish-receipt",
    capability: "publishing",
    mediaType: "text/plain",
    url: "https://x.com/shapelessai/status/1234567890",
    meta: { title: "Posted to X" },
  }),
];

export const POST_ARTIFACT = art({
  id: "a-post",
  type: "post",
  capability: "publishing",
  mediaType: "text/plain",
  text: "We shipped the launch short in a weekend. Here is the three-minute version of what it took.",
  meta: { platform: "linkedin", title: "LinkedIn draft" },
});

export const conversation = () => ({
  id: CONVERSATION_ID,
  title: "Launch short",
  createdAt: AT,
  updatedAt: AT,
  activeRunAt: null,
  strategyId: null,
  createdBy: "chat",
  messages: [
    {
      id: "m-user",
      role: "user",
      parts: [{ type: "text", text: "Make me a short about the launch and draft the LinkedIn post." }],
      blocks: [],
      artifacts: [],
    },
    {
      id: "m-agent",
      role: "agent",
      parts: [
        { type: "text", text: "Here is the short, and the LinkedIn draft to go with it." },
        {
          type: "artifacts",
          artifactIds: [...SHELF_ARTIFACTS.map((a) => a.id), POST_ARTIFACT.id],
        },
      ],
      blocks: [],
      artifacts: [...SHELF_ARTIFACTS, POST_ARTIFACT],
    },
  ],
});

export const CONNECTION = {
  id: "conn-e2e-linkedin",
  platform: "linkedin",
  handle: "local-review",
  displayName: "Local Review",
  avatarUrl: null,
  groupId: null,
  status: "active",
  mode: "oauth",
  followers: 1240,
  readsMetrics: true,
  analyticsScopeRequestable: true,
};
