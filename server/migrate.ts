import { postgres, migrate } from "./db.js";
const db = postgres();
try {
  await migrate(db);
  console.log("Schema ready");
} finally {
  await db.close();
}
