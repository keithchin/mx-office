// GET /api/csrf: the request token of the session asking (../origin.ts), for a tool that changes something
// through the signed-in routes without being the office's page (a script with a session cookie). The office's
// own pages never need it: the browser sends their Origin. Another site can't read the answer (no CORS).

import { csrfToken, CSRF_HEADER } from '../origin.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const csrfRoutes = {
  token: {
    method: 'GET',
    path: '/api/csrf',
    auth: 'session',
    handle(_ctx, { req, res }) {
      const token = csrfToken(req);
      if (!token) return send(res, 400, { error: 'This session has no cookie to tie a request token to' });
      return send(res, 200, { header: CSRF_HEADER, token });
    },
  },
} satisfies Record<string, Route>;
