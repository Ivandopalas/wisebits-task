import { z } from 'zod';

// The web app's Content-Security-Policy has no 'unsafe-eval'. Zod probes for it with
// `new Function` as each object schema is built, and the browser reports a violation; these
// schemas are small enough that compiled parsers buy nothing anyway.
z.config({ jitless: true });
