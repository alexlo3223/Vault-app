// Vercel entry point: the same server as the desktop app, with the notes in Supabase and a sign-in in front.
// vercel.json sends /api, /auth and /oauth here; the pages, scripts and fonts are served from app/public.
import { createHandler } from '../app/server.mjs';
import { createCloud } from '../app/lib/cloud.mjs';

export default createHandler({ cloud: createCloud() });
