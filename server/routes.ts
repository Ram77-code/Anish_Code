import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./replit_integrations/auth"; // For Replit Auth
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { insertProblemSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup Replit Auth first
  await setupAuth(app);

  // === API ROUTES ===

  // Problems
  app.get(api.problems.list.path, async (req, res) => {
    const problems = await storage.getProblems();
    res.json(problems);
  });

  app.get(api.problems.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const problem = await storage.getProblem(id);
    if (!problem) {
      return res.status(404).json({ message: "Problem not found" });
    }
    res.json(problem);
  });

  // Submissions
  app.post(api.submissions.create.path, async (req, res) => {
    // Check authentication
    if (!req.isAuthenticated()) {
       return res.status(401).json({ message: "Unauthorized" });
    }
    
    // Get the user ID from the Replit Auth session
    const userId = (req.user as any).id; // Or req.user.claims.sub depending on passport config

    try {
      const input = api.submissions.create.input.parse(req.body);
      
      // Mock execution logic
      // In a real app, send to a judge service.
      const statuses = ["Accepted", "Wrong Answer", "Runtime Error"];
      const status = Math.random() > 0.3 ? "Accepted" : statuses[Math.floor(Math.random() * statuses.length)];
      const runtime = Math.floor(Math.random() * 100);

      const submission = await storage.createSubmission({
        userId: userId,
        problemId: input.problemId,
        code: input.code,
        status,
        runtime,
      });

      res.status(201).json(submission);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get(api.submissions.list.path, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = (req.user as any).id;
    const submissions = await storage.getUserSubmissions(userId);
    res.json(submissions);
  });
  
  // Get current user (overriding or supplementing auth routes)
  app.get(api.users.me.path, (req, res) => {
    if (!req.isAuthenticated()) {
      return res.json(null);
    }
    res.json(req.user);
  });

  // Seed Data
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const existingProblems = await storage.getProblems();
  if (existingProblems.length === 0) {
    await storage.createProblem({
      title: "Two Sum",
      slug: "two-sum",
      difficulty: "Easy",
      category: "Array",
      description: `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.

**Example 1:**
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].

**Example 2:**
Input: nums = [3,2,4], target = 6
Output: [1,2]

**Example 3:**
Input: nums = [3,3], target = 6
Output: [0,1]
`,
      starterCode: `function twoSum(nums, target) {
  // Write your code here
};`,
      testCases: [
        { input: "nums = [2,7,11,15], target = 9", output: "[0,1]" },
        { input: "nums = [3,2,4], target = 6", output: "[1,2]" }
      ],
      order: 1,
    });

    await storage.createProblem({
      title: "Valid Parentheses",
      slug: "valid-parentheses",
      difficulty: "Medium",
      category: "Stack",
      description: `Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.

**Example 1:**
Input: s = "()"
Output: true

**Example 2:**
Input: s = "()[]{}"
Output: true

**Example 3:**
Input: s = "(]"
Output: false
`,
      starterCode: `function isValid(s) {
  // Write your code here
};`,
      testCases: [
        { input: 's = "()"', output: "true" },
        { input: 's = "()[]{}"', output: "true" }
      ],
      order: 2,
    });
  }
}
