import "dotenv/config";
import { postgres } from "./db.js";
import { seed } from "./seed-data.js";
const db = postgres();
try {
  await seed(db, process.env.SEED_PASSWORD || "", true);
  console.log(
    "Demo accounts and samples ready. Existing passwords are not reset.",
  );
} finally {
  await db.close();
}
