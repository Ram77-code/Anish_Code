import { users, problems, submissions, type User, type InsertUser, type Problem, type InsertProblem, type Submission, type InsertSubmission } from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getProblems(): Promise<Problem[]>;
  getProblem(id: number): Promise<Problem | undefined>;
  createProblem(problem: InsertProblem): Promise<Problem>;

  createSubmission(submission: InsertSubmission): Promise<Submission>;
  getUserSubmissions(userId: string): Promise<(Submission & { problemTitle: string })[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getProblems(): Promise<Problem[]> {
    return await db.select().from(problems).orderBy(problems.order);
  }

  async getProblem(id: number): Promise<Problem | undefined> {
    const [problem] = await db.select().from(problems).where(eq(problems.id, id));
    return problem;
  }

  async createProblem(problem: InsertProblem): Promise<Problem> {
    const [newProblem] = await db.insert(problems).values(problem).returning();
    return newProblem;
  }

  async createSubmission(submission: InsertSubmission): Promise<Submission> {
    const [newSubmission] = await db.insert(submissions).values(submission).returning();
    return newSubmission;
  }

  async getUserSubmissions(userId: string): Promise<(Submission & { problemTitle: string })[]> {
    const result = await db
      .select({
        id: submissions.id,
        userId: submissions.userId,
        problemId: submissions.problemId,
        code: submissions.code,
        status: submissions.status,
        runtime: submissions.runtime,
        createdAt: submissions.createdAt,
        problemTitle: problems.title,
      })
      .from(submissions)
      .innerJoin(problems, eq(submissions.problemId, problems.id))
      .where(eq(submissions.userId, userId))
      .orderBy(desc(submissions.createdAt));
    
    return result;
  }
}

export const storage = new DatabaseStorage();
