import { NextResponse } from "next/server";
import {
  findUserByEmail,
  verifyPassword,
  createSessionToken,
  AUTH_COOKIE_NAME,
  SESSION_DURATION_MS,
  ensureUsersTable,
  seedOrUpdateUser,
} from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    await ensureUsersTable();

    // Check if any users exist in the DB. If DB is empty, auto-seed the initial admin account.
    const countResult = await sql`SELECT COUNT(*)::int as count FROM users;`;
    const userCount = countResult[0]?.count ?? 0;

    // Only auto-seed when the deployer has actually configured an admin
    // account via env vars — never fall back to a hardcoded default, or
    // anyone who's read this source could log into a fresh deployment.
    if (userCount === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      await seedOrUpdateUser(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Generate signed session token
    const token = await createSessionToken(user.id, user.email);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });

    // Set secure HTTP-only session cookie
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return response;
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "An unexpected error occurred during login." },
      { status: 500 }
    );
  }
}
