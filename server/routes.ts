import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./replit_integrations/auth";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import type { InsertProblem } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication first
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
    
    // Get the user ID from the authenticated session
    const userId = (req.user as any).id;

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
  const existingSlugs = new Set(existingProblems.map((problem) => problem.slug));

  const defaultProblems: InsertProblem[] = [
    {
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
    },
    {
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
    },
    {
      title: "Merge Two Sorted Lists",
      slug: "merge-two-sorted-lists",
      difficulty: "Easy",
      category: "Linked List",
      description: `You are given the heads of two sorted linked lists list1 and list2.

Merge the two lists into one sorted list and return the head of the merged list.

**Example 1:**
Input: list1 = [1,2,4], list2 = [1,3,4]
Output: [1,1,2,3,4,4]

**Example 2:**
Input: list1 = [], list2 = []
Output: []
`,
      starterCode: `function mergeTwoLists(list1, list2) {
  // Write your code here
};`,
      testCases: [
        { input: "list1 = [1,2,4], list2 = [1,3,4]", output: "[1,1,2,3,4,4]" },
        { input: "list1 = [], list2 = []", output: "[]" }
      ],
      order: 3,
    },
    {
      title: "Best Time to Buy and Sell Stock",
      slug: "best-time-to-buy-and-sell-stock",
      difficulty: "Easy",
      category: "Array",
      description: `You are given an array prices where prices[i] is the price of a given stock on the ith day.

Find the maximum profit you can achieve from a single buy and a single sell.

**Example 1:**
Input: prices = [7,1,5,3,6,4]
Output: 5

**Example 2:**
Input: prices = [7,6,4,3,1]
Output: 0
`,
      starterCode: `function maxProfit(prices) {
  // Write your code here
};`,
      testCases: [
        { input: "prices = [7,1,5,3,6,4]", output: "5" },
        { input: "prices = [7,6,4,3,1]", output: "0" }
      ],
      order: 4,
    },
    {
      title: "Maximum Subarray",
      slug: "maximum-subarray",
      difficulty: "Medium",
      category: "Dynamic Programming",
      description: `Given an integer array nums, find the contiguous subarray with the largest sum and return its sum.

**Example 1:**
Input: nums = [-2,1,-3,4,-1,2,1,-5,4]
Output: 6
Explanation: [4,-1,2,1] has the largest sum = 6.

**Example 2:**
Input: nums = [1]
Output: 1
`,
      starterCode: `function maxSubArray(nums) {
  // Write your code here
};`,
      testCases: [
        { input: "nums = [-2,1,-3,4,-1,2,1,-5,4]", output: "6" },
        { input: "nums = [1]", output: "1" }
      ],
      order: 5,
    },
    {
      title: "Binary Search",
      slug: "binary-search",
      difficulty: "Easy",
      category: "Binary Search",
      description: `Given a sorted array of integers nums and an integer target, return the index of target if it exists, otherwise return -1.

**Example 1:**
Input: nums = [-1,0,3,5,9,12], target = 9
Output: 4

**Example 2:**
Input: nums = [-1,0,3,5,9,12], target = 2
Output: -1
`,
      starterCode: `function search(nums, target) {
  // Write your code here
};`,
      testCases: [
        { input: "nums = [-1,0,3,5,9,12], target = 9", output: "4" },
        { input: "nums = [-1,0,3,5,9,12], target = 2", output: "-1" }
      ],
      order: 6,
    },
  ];

  for (const problem of defaultProblems) {
    if (!existingSlugs.has(problem.slug)) {
      await storage.createProblem(problem);
    }
  }
}
