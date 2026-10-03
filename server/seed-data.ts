import type { Database } from "./db.js";
import { one } from "./db.js";
import { uid, audit, createContent } from "./service.js";
import { passwordHash } from "./auth.js";
import type { Role, User } from "../shared/contracts.js";
export async function seed(db: Database, password: string, examples = false) {
  if (password.length < 12)
    throw Error("SEED_PASSWORD must contain at least 12 characters");
  const hashed = await passwordHash(password);
  return db.tx(async (q) => {
    const users: Record<string, User> = {};
    for (const [key, name, role] of [
      ["author", "Alex Morgan", "AUTHOR"],
      ["author2", "Jordan Lee", "AUTHOR"],
      ["moderator", "Sam Rivera", "MODERATOR"],
      ["moderator2", "Taylor Chen", "MODERATOR"],
      ["reviewer", "Casey Brooks", "REVIEWER"],
      ["reviewer2", "Riley Patel", "REVIEWER"],
      ["admin", "Firoz Ahmad", "ADMIN"],
    ]) {
      const email = key + "@veridict.local";
      await q.query(
        "INSERT INTO users(id,name,email,password,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING",
        [uid(), name, email, hashed, role],
      );
      users[key] = (await one<User>(
        q,
        "SELECT id,name,email,role FROM users WHERE email=$1",
        [email],
      ))!;
    }
    const p = await one(q, "SELECT policy_id FROM app_state WHERE id=1");
    if (!p?.policy_id) {
      const id = uid();
      const clauses = [
        {
          key: "LINKS",
          text: "Do not post links containing scam.invalid. These links are prohibited even in promotional examples.",
          severity: "HIGH",
          term: "scam.invalid",
        },
        {
          key: "THREATS",
          text: "Do not make credible threats of physical harm against another person. Distinguish quotation and fictional discussion from direct threats.",
          severity: "CRITICAL",
          term: "",
        },
        {
          key: "HARASSMENT",
          text: "Do not target a person with repeated degrading abuse. Criticism of ideas is allowed. Context and uncertainty require human judgment.",
          severity: "MEDIUM",
          term: "",
        },
        {
          key: "PRIVACY",
          text: "Do not share another person’s private contact or location details without their permission.",
          severity: "HIGH",
          term: "",
        },
      ];
      await q.query(
        "INSERT INTO policies(id,version,title,clauses) VALUES($1,1,$2,$3)",
        [id, "Community safety policy", JSON.stringify(clauses)],
      );
      await q.query("UPDATE app_state SET policy_id=$1 WHERE id=1", [id]);
      await audit(q, users.admin.id, "POLICY_PUBLISHED", id, { version: 1 });
    }
    if (examples && !(await one(q, "SELECT id FROM contents LIMIT 1"))) {
      for (const text of [
        "Welcome to our community! What are you building this week?",
        "Visit scam.invalid to collect your prize today.",
        "I disagree with this proposal; here are three improvements.",
        "This fictional character threatens the villain in chapter two.",
        "Can we review whether this repeated personal criticism crosses a line?",
        "A reminder: never share private contact information.",
      ])
        await createContent(q, users.author, { text, type: "POST" });
    }
    return users;
  });
}
