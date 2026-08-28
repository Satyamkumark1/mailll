import { seedOrUpdateUser } from "../lib/auth";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set to seed a user.");
    process.exit(1);
  }

  console.log(`Seeding user: ${email}...`);
  try {
    const user = await seedOrUpdateUser(email, password);
    console.log(`Successfully seeded user: ${user.email} (ID: ${user.id})`);
  } catch (error) {
    console.error("Failed to seed user:", error);
    process.exit(1);
  }
}

main();
