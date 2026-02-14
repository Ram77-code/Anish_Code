import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

// Re-export users from auth model so it can be used throughout the app
export { users };
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// === TABLE DEFINITIONS ===

export const problems = pgTable("problems", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  difficulty: text("difficulty").notNull(), // "Easy", "Medium", "Hard"
  category: text("category").notNull(),
  description: text("description").notNull(),
  starterCode: text("starter_code").notNull(),
  testCases: jsonb("test_cases").$type<{input: string, output: string}[]>(),
  order: integer("order").default(0),
});

export const submissions = pgTable("submissions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(), // References users.id (varchar from auth)
  problemId: integer("problem_id").notNull(), // references problems.id
  code: text("code").notNull(),
  status: text("status").notNull(), // "Accepted", "Wrong Answer", "Runtime Error"
  runtime: integer("runtime"), // in ms
  createdAt: timestamp("created_at").defaultNow(),
});

// === SCHEMAS ===

export const insertProblemSchema = createInsertSchema(problems).omit({ id: true });
export const insertSubmissionSchema = createInsertSchema(submissions).omit({ id: true, createdAt: true, status: true, runtime: true });

// === TYPES ===

export type Problem = typeof problems.$inferSelect;
export type InsertProblem = z.infer<typeof insertProblemSchema>;

export type Submission = typeof submissions.$inferSelect;
export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;

// === API CONTRACT TYPES ===

export type CreateSubmissionRequest = {
  code: string;
  problemId: number;
};

export type SubmissionResponse = Submission & {
  problemTitle?: string;
};
