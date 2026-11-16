// SAVE AS: lib/auth.js
// Better Auth server instance. Minimal on purpose: email + password
// only, no extra plugins. The Prisma adapter uses the postgresql
// provider. First user in the database becomes Admin (see hook below).

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  // Expose the app's role/isActive columns on the session user so login
  // and signup pages can read the role from getSession() and redirect
  // kitchen -> /kitchen, rider -> /delivery. input: false is REQUIRED:
  // without it a signup request could set its own role to "admin".
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "cashier", input: false },
      isActive: { type: "boolean", defaultValue: true, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // First account ever created becomes Admin so the restaurant
          // owner can sign up once and immediately manage everything.
          // Every later account keeps the schema default role (cashier)
          // until an admin changes it. Failures here must not break
          // signup, so errors are logged, never thrown.
          try {
            const count = await prisma.user.count();
            if (count === 1) {
              await prisma.user.update({
                where: { id: user.id },
                data: { role: "admin" },
              });
            }
          } catch (error) {
            console.error("First-user admin promotion failed:", error);
          }
        },
      },
    },
  },
});

export default auth;
