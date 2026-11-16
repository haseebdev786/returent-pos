// SAVE AS: lib/auth-client.js
// Better Auth client. NO baseURL — same-origin requests, so the client
// works on localhost and on the deployed domain without config changes.

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export default authClient;
