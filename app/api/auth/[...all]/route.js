// SAVE AS: app/api/auth/[...all]/route.js
// Better Auth handler. Errors are logged with their REAL message and,
// in development, returned with the real message too — never masked as
// a generic 503, so auth failures are diagnosable from the response.

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

function isDev() {
  return process.env.NODE_ENV !== "production";
}

export async function GET(request, context) {
  try {
    return await handler.GET(request, context);
  } catch (error) {
    console.error("Better Auth GET error:", error);
    if (isDev()) {
      return Response.json(
        { error: error?.message || "Auth handler failed" },
        { status: 500 },
      );
    }
    throw error;
  }
}

export async function POST(request, context) {
  try {
    return await handler.POST(request, context);
  } catch (error) {
    console.error("Better Auth POST error:", error);
    if (isDev()) {
      return Response.json(
        { error: error?.message || "Auth handler failed" },
        { status: 500 },
      );
    }
    throw error;
  }
}
