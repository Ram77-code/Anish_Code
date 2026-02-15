import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./replit_integrations/auth";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { problems, type InsertProblem } from "@shared/schema";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { db } from "./db";
import { eq } from "drizzle-orm";

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

  // Run code against test cases without persisting a submission
  app.post(api.submissions.run.path, async (req, res) => {
    try {
      const input = api.submissions.run.input.parse(req.body);
      const problem = await storage.getProblem(input.problemId);
      if (!problem) {
        return res.status(404).json({ message: "Problem not found" });
      }

      const execution = runAgainstTestCases(
        input.code,
        problem.testCases ?? [],
        input.language,
        extractExpectedFunctionName(problem.starterCode),
        (problem.order ?? 0) >= 7 ? "execution_only" : "strict"
      );
      return res.status(200).json(execution);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(500).json({ message: "Failed to run code" });
    }
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
      const problem = await storage.getProblem(input.problemId);
      if (!problem) {
        return res.status(404).json({ message: "Problem not found" });
      }

      const execution = runAgainstTestCases(
        input.code,
        problem.testCases ?? [],
        input.language,
        extractExpectedFunctionName(problem.starterCode),
        (problem.order ?? 0) >= 7 ? "execution_only" : "strict"
      );

      const submission = await storage.createSubmission({
        userId: userId,
        problemId: input.problemId,
        code: input.code,
        status: execution.status,
        runtime: execution.runtime,
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

type TestCase = { input: string; output: string };
type SupportedLanguage = "javascript" | "python";
type ExecutionMode = "strict" | "execution_only";
type JsResolvedCallable = {
  argNames: string[];
  fallbackArity: number;
};

function buildFatalRunResult(message: string, testCases: TestCase[]) {
  return {
    status: "Runtime Error" as const,
    runtime: 0,
    passed: 0,
    total: testCases.length,
    results: testCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.output,
      passed: false,
      error: message,
    })),
  };
}

function parseLiteral(expression: string): unknown {
  return vm.runInNewContext(`(${expression})`, {}, { timeout: 1000 });
}

function extractExpectedFunctionName(starterCode: string): string | null {
  const jsMatch = starterCode.match(
    /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/m
  );
  if (jsMatch) {
    return jsMatch[1];
  }

  const pyMatch = starterCode.match(/def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
  if (pyMatch) {
    return pyMatch[1];
  }

  return null;
}

function parseAssignments(input: string): Record<string, unknown> {
  const orderedNames = parseAssignmentOrder(input);
  if (orderedNames.length === 0) {
    return {};
  }

  const declarations = orderedNames.map((name) => `let ${name};`).join("\n");
  const returnShape = orderedNames.join(", ");
  const script = `
(() => {
${declarations}
${input};
return { ${returnShape} };
})()
`;

  return vm.runInNewContext(script, {}, { timeout: 1000 }) as Record<
    string,
    unknown
  >;
}

function parseAssignmentOrder(input: string): string[] {
  const assignmentRegex = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = assignmentRegex.exec(input)) !== null) {
    const name = match[1];
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function buildCallArgs(
  signatureArgs: string[],
  inputByName: Record<string, unknown>,
  inputOrder: string[],
  fallbackArity = 0
): unknown[] {
  const hasAllNamedArgs =
    signatureArgs.length > 0 &&
    signatureArgs.every((argName) => Object.prototype.hasOwnProperty.call(inputByName, argName));

  if (hasAllNamedArgs) {
    return signatureArgs.map((argName) => inputByName[argName]);
  }

  const orderedValues = inputOrder
    .filter((name) => Object.prototype.hasOwnProperty.call(inputByName, name))
    .map((name) => inputByName[name]);

  if (signatureArgs.length === 0) {
    if (fallbackArity > 0) {
      return orderedValues.slice(0, fallbackArity);
    }
    return orderedValues;
  }

  return orderedValues.slice(0, signatureArgs.length);
}

function findJsClassMethodSignature(code: string): {
  className: string;
  methodName: string;
  args: string[];
} | null {
  const classMatch = code.match(
    /class\s+([A-Za-z_$][A-Za-z0-9_$]*)[\s\S]*?{([\s\S]*?)}/m
  );
  if (!classMatch) {
    return null;
  }

  const [, className, classBody] = classMatch;
  const methodMatch = classBody.match(
    /([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*{/m
  );
  if (!methodMatch) {
    return null;
  }

  const [, methodName, argsCsv] = methodMatch;
  return {
    className,
    methodName,
    args: argsCsv
      .split(",")
      .map((arg) => arg.trim())
      .filter(Boolean),
  };
}

function resolveJavascriptCallable(
  code: string,
  executionContext: vm.Context,
  expectedFunctionName: string | null
): JsResolvedCallable {
  const beforeKeys = vm.runInContext(
    "Object.getOwnPropertyNames(globalThis)",
    executionContext,
    { timeout: 500 }
  ) as string[];

  const compiled = new vm.Script(code);
  compiled.runInContext(executionContext, { timeout: 1000 });

  if (expectedFunctionName) {
    const hasExpected = vm.runInContext(
      `typeof globalThis[${JSON.stringify(expectedFunctionName)}] === "function"`,
      executionContext,
      { timeout: 500 }
    ) as boolean;
    if (hasExpected) {
      vm.runInContext(
        `globalThis.__solution = globalThis[${JSON.stringify(expectedFunctionName)}]`,
        executionContext,
        { timeout: 500 }
      );
      const arity = vm.runInContext("__solution.length", executionContext, {
        timeout: 500,
      }) as number;
      return {
        argNames: [],
        fallbackArity: arity,
      };
    }
  }

  try {
    const signature = findFunctionSignature(code);
    const hasNamedFunction = vm.runInContext(
      `typeof ${signature.name} === "function"`,
      executionContext,
      { timeout: 500 }
    ) as boolean;
    if (hasNamedFunction) {
      vm.runInContext(`globalThis.__solution = ${signature.name}`, executionContext, {
        timeout: 500,
      });
      const arity = vm.runInContext("__solution.length", executionContext, {
        timeout: 500,
      }) as number;
      return {
        argNames: signature.args,
        fallbackArity: arity,
      };
    }
  } catch {
    // Ignore and continue to fallbacks.
  }

  const classMethod = findJsClassMethodSignature(code);
  if (classMethod) {
    const hasClass = vm.runInContext(
      `typeof ${classMethod.className} === "function"`,
      executionContext,
      { timeout: 500 }
    ) as boolean;
    if (hasClass) {
      vm.runInContext(
        `globalThis.__solution = (...args) => (new ${classMethod.className}()).${classMethod.methodName}(...args)`,
        executionContext,
        { timeout: 500 }
      );
      return {
        argNames: classMethod.args,
        fallbackArity: classMethod.args.length,
      };
    }
  }

  const afterKeys = vm.runInContext(
    "Object.getOwnPropertyNames(globalThis)",
    executionContext,
    { timeout: 500 }
  ) as string[];
  const newFunctionKeys = afterKeys.filter(
    (key) =>
      !beforeKeys.includes(key) &&
      ((vm.runInContext(`typeof globalThis[${JSON.stringify(key)}] === "function"`, executionContext, {
        timeout: 500,
      }) as boolean) ||
        false)
  );

  if (newFunctionKeys.length > 0) {
    const candidate = newFunctionKeys[0];
    vm.runInContext(
      `globalThis.__solution = globalThis[${JSON.stringify(candidate)}]`,
      executionContext,
      {
        timeout: 500,
      }
    );
    const arity = vm.runInContext("__solution.length", executionContext, {
      timeout: 500,
    }) as number;
    return {
      argNames: [],
      fallbackArity: arity,
    };
  }

  const commonNames = ["solve", "solution", "main"];
  for (const commonName of commonNames) {
    const exists = vm.runInContext(
      `typeof globalThis[${JSON.stringify(commonName)}] === "function"`,
      executionContext,
      { timeout: 500 }
    ) as boolean;
    if (exists) {
      vm.runInContext(
        `globalThis.__solution = globalThis[${JSON.stringify(commonName)}]`,
        executionContext,
        { timeout: 500 }
      );
      const arity = vm.runInContext("__solution.length", executionContext, {
        timeout: 500,
      }) as number;
      return {
        argNames: [],
        fallbackArity: arity,
      };
    }
  }

  const moduleExportFn = vm.runInContext(
    "typeof module !== 'undefined' && module && typeof module.exports === 'function'",
    executionContext,
    { timeout: 500 }
  ) as boolean;
  if (moduleExportFn) {
    vm.runInContext("globalThis.__solution = module.exports", executionContext, {
      timeout: 500,
    });
    const arity = vm.runInContext("__solution.length", executionContext, {
      timeout: 500,
    }) as number;
    return {
      argNames: [],
      fallbackArity: arity,
    };
  }

  const moduleDefaultFn = vm.runInContext(
    "typeof module !== 'undefined' && module && module.exports && typeof module.exports.default === 'function'",
    executionContext,
    { timeout: 500 }
  ) as boolean;
  if (moduleDefaultFn) {
    vm.runInContext("globalThis.__solution = module.exports.default", executionContext, {
      timeout: 500,
    });
    const arity = vm.runInContext("__solution.length", executionContext, {
      timeout: 500,
    }) as number;
    return {
      argNames: [],
      fallbackArity: arity,
    };
  }

  throw new Error("No callable solution function found.");
}

function findFunctionSignature(code: string): { name: string; args: string[] } {
  const declarationMatch = code.match(
    /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/m
  );
  if (declarationMatch) {
    const [, name, argsCsv] = declarationMatch;
    return {
      name,
      args: argsCsv
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean),
    };
  }

  const assignedArrowMatch = code.match(
    /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\(([^)]*)\)\s*=>/m
  );
  if (assignedArrowMatch) {
    const [, name, argsCsv] = assignedArrowMatch;
    return {
      name,
      args: argsCsv
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean),
    };
  }

  const assignedNamedFunctionMatch = code.match(
    /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*function\s*\(([^)]*)\)/m
  );
  if (assignedNamedFunctionMatch) {
    const [, name, argsCsv] = assignedNamedFunctionMatch;
    return {
      name,
      args: argsCsv
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean),
    };
  }

  const singleArgArrowMatch = code.match(
    /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/m
  );
  if (singleArgArrowMatch) {
    const [, name, arg] = singleArgArrowMatch;
    return { name, args: [arg] };
  }

  throw new Error("Could not detect a function declaration in submitted code.");
}

function findPythonFunctionSignature(code: string): {
  name: string;
  args: string[];
} {
  const match = code.match(
    /def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/m
  );
  if (!match) {
    throw new Error("Could not detect a Python function declaration.");
  }

  const [, name, argsCsv] = match;
  const args = argsCsv
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => arg.split("=")[0].trim())
    .filter(Boolean);

  return { name, args };
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = normalizeValue(record[key]);
    }
    return normalized;
  }
  return value;
}

function normalize(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function runJavascriptAgainstTestCases(
  code: string,
  testCases: TestCase[],
  expectedFunctionName: string | null,
  mode: ExecutionMode
) {
  const startedAt = Date.now();
  let resolvedCallable: JsResolvedCallable;
  let executionContext: vm.Context;

  try {
    executionContext = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
    });
    resolvedCallable = resolveJavascriptCallable(code, executionContext, expectedFunctionName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution error";
    return buildFatalRunResult(message, testCases);
  }

  const solution = (executionContext as Record<string, unknown>).__solution;
  if (typeof solution !== "function") {
    return buildFatalRunResult("No callable solution function found.", testCases);
  }

  const results = testCases.map((testCase) => {
    try {
      const inputByName = parseAssignments(testCase.input);
      const inputOrder = parseAssignmentOrder(testCase.input);
      const args = buildCallArgs(
        resolvedCallable.argNames,
        inputByName,
        inputOrder,
        resolvedCallable.fallbackArity
      );
      (executionContext as Record<string, unknown>).__args = args;
      const actualValue = vm.runInContext("__solution(...__args)", executionContext, {
        timeout: 1000,
      });
      const expectedValue = parseLiteral(testCase.output);
      const passed =
        mode === "execution_only"
          ? true
          : normalize(actualValue) === normalize(expectedValue);

      return {
        input: testCase.input,
        expected: normalize(expectedValue),
        actual: normalize(actualValue),
        passed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution error";
      return {
        input: testCase.input,
        expected: testCase.output,
        passed: false,
        error: message,
      };
    }
  });

  const passed = results.filter((result) => result.passed).length;
  const status =
    passed === results.length
      ? "Accepted"
      : results.some((result) => result.error)
      ? "Runtime Error"
      : "Wrong Answer";

  return {
    status,
    runtime: Date.now() - startedAt,
    passed,
    total: results.length,
    results,
  };
}

function runPythonCase(
  code: string,
  functionName: string | null,
  args: unknown[]
): { ok: true; actual: unknown } | { ok: false; error: string } {
  const pythonScript = `
import json
import sys
import inspect

payload = json.loads(sys.stdin.read())
namespace = {}

try:
    exec(payload["code"], namespace, namespace)
    fn = None
    function_name = payload.get("functionName")
    arg_count = len(payload["args"])

    if function_name:
        candidate = namespace.get(function_name)
        if callable(candidate):
            fn = candidate

    if fn is None:
        solution_cls = namespace.get("Solution")
        if solution_cls is not None:
            instance = solution_cls()
            class_methods = []
            for method_name in dir(instance):
                if method_name.startswith("_"):
                    continue
                method = getattr(instance, method_name, None)
                if callable(method):
                    class_methods.append((method_name, method))
            exact = []
            for method_name, method in class_methods:
                try:
                    sig = inspect.signature(method)
                    if len(sig.parameters) == arg_count:
                        exact.append((method_name, method))
                except Exception:
                    continue
            if exact:
                fn = exact[0][1]
            elif class_methods:
                fn = class_methods[0][1]

    if fn is None:
        top_level_functions = []
        for key, value in namespace.items():
            if key.startswith("_"):
                continue
            if inspect.isfunction(value):
                top_level_functions.append((key, value))
        exact = []
        for key, value in top_level_functions:
            try:
                sig = inspect.signature(value)
                if len(sig.parameters) == arg_count:
                    exact.append((key, value))
            except Exception:
                continue
        if exact:
            fn = exact[0][1]
        elif top_level_functions:
            fn = top_level_functions[0][1]

    if not callable(fn):
        raise Exception("No callable solution function found.")
    result = fn(*payload["args"])
    print(json.dumps({"ok": True, "actual": result}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;

  const payload = JSON.stringify({ code, functionName, args });
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: "python", args: ["-c", pythonScript] },
    { cmd: "py", args: ["-3", "-c", pythonScript] },
  ];

  for (const attempt of attempts) {
    const execution = spawnSync(attempt.cmd, attempt.args, {
      input: payload,
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 1024 * 1024,
    });

    if (execution.error) {
      if ((execution.error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      return { ok: false, error: execution.error.message };
    }

    const stdout = execution.stdout?.trim();
    if (!stdout) {
      const stderr = execution.stderr?.trim() || "Python execution failed.";
      return { ok: false, error: stderr };
    }

    try {
      const parsed = JSON.parse(stdout) as
        | { ok: true; actual: unknown }
        | { ok: false; error: string };
      return parsed;
    } catch {
      return { ok: false, error: "Invalid Python runner response." };
    }
  }

  return {
    ok: false,
    error: "Python runtime not found. Install Python and try again.",
  };
}

function runPythonAgainstTestCases(
  code: string,
  testCases: TestCase[],
  expectedFunctionName: string | null,
  mode: ExecutionMode
) {
  const startedAt = Date.now();
  let signature: { name: string; args: string[] } | null = null;
  try {
    signature = findPythonFunctionSignature(code);
  } catch {
    signature = null;
  }

  const results = testCases.map((testCase) => {
    try {
      const inputByName = parseAssignments(testCase.input);
      const inputOrder = parseAssignmentOrder(testCase.input);
      const args = buildCallArgs(
        signature?.args ?? [],
        inputByName,
        inputOrder,
        signature?.args.length ?? 0
      );
      const expectedValue = parseLiteral(testCase.output);
      const execution = runPythonCase(
        code,
        signature?.name ?? expectedFunctionName,
        args
      );
      if (!execution.ok) {
        return {
          input: testCase.input,
          expected: normalize(expectedValue),
          passed: false,
          error: execution.error,
        };
      }

      const actualValue = execution.actual;
      const passed =
        mode === "execution_only"
          ? true
          : normalize(actualValue) === normalize(expectedValue);
      return {
        input: testCase.input,
        expected: normalize(expectedValue),
        actual: normalize(actualValue),
        passed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution error";
      return {
        input: testCase.input,
        expected: testCase.output,
        passed: false,
        error: message,
      };
    }
  });

  const passed = results.filter((result) => result.passed).length;
  const status =
    passed === results.length
      ? "Accepted"
      : results.some((result) => result.error)
      ? "Runtime Error"
      : "Wrong Answer";

  return {
    status,
    runtime: Date.now() - startedAt,
    passed,
    total: results.length,
    results,
  };
}

function runJavascriptExecutionOnly(code: string, testCases: TestCase[]) {
  const startedAt = Date.now();
  const syntheticCases =
    testCases.length > 0
      ? testCases
      : [{ input: "execution-only", output: "code executes without runtime errors" }];
  try {
    const context = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
    });
    const script = new vm.Script(code);
    script.runInContext(context, { timeout: 1000 });

    return {
      status: "Accepted" as const,
      runtime: Date.now() - startedAt,
      passed: syntheticCases.length,
      total: syntheticCases.length,
      results: syntheticCases.map((tc) => ({
          input: tc.input,
          expected: tc.output,
          actual: "executed",
          passed: true,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution error";
    return {
      status: "Runtime Error" as const,
      runtime: Date.now() - startedAt,
      passed: 0,
      total: syntheticCases.length,
      results: syntheticCases.map((tc) => ({
          input: tc.input,
          expected: tc.output,
          passed: false,
          error: message,
      })),
    };
  }
}

function runPythonExecutionOnly(code: string, testCases: TestCase[]) {
  const startedAt = Date.now();
  const syntheticCases =
    testCases.length > 0
      ? testCases
      : [{ input: "execution-only", output: "code executes without runtime errors" }];
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: "python", args: ["-c", code] },
    { cmd: "py", args: ["-3", "-c", code] },
  ];

  for (const attempt of attempts) {
    const execution = spawnSync(attempt.cmd, attempt.args, {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 1024 * 1024,
    });

    if (execution.error) {
      if ((execution.error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      return {
        status: "Runtime Error" as const,
        runtime: Date.now() - startedAt,
        passed: 0,
        total: syntheticCases.length,
        results: syntheticCases.map((tc) => ({
            input: tc.input,
            expected: tc.output,
            passed: false,
            error: execution.error?.message ?? "Python execution failed.",
        })),
      };
    }

    if (execution.status !== 0) {
      const errMessage =
        execution.stderr?.trim() || execution.stdout?.trim() || "Execution failed";
      return {
        status: "Runtime Error" as const,
        runtime: Date.now() - startedAt,
        passed: 0,
        total: syntheticCases.length,
        results: syntheticCases.map((tc) => ({
            input: tc.input,
            expected: tc.output,
            passed: false,
            error: errMessage,
        })),
      };
    }

    return {
      status: "Accepted" as const,
      runtime: Date.now() - startedAt,
      passed: syntheticCases.length,
      total: syntheticCases.length,
      results: syntheticCases.map((tc) => ({
          input: tc.input,
          expected: tc.output,
          actual: "executed",
          passed: true,
      })),
    };
  }

  return {
    status: "Runtime Error" as const,
    runtime: Date.now() - startedAt,
    passed: 0,
    total: syntheticCases.length,
    results: syntheticCases.map((tc) => ({
        input: tc.input,
        expected: tc.output,
        passed: false,
        error: "Python runtime not found. Install Python and try again.",
    })),
  };
}

function runAgainstTestCases(
  code: string,
  testCases: TestCase[],
  language: SupportedLanguage,
  expectedFunctionName: string | null,
  mode: ExecutionMode
) {
  if (mode === "execution_only") {
    return language === "python"
      ? runPythonExecutionOnly(code, testCases)
      : runJavascriptExecutionOnly(code, testCases);
  }

  if (language === "python") {
    return runPythonAgainstTestCases(code, testCases, expectedFunctionName, mode);
  }
  return runJavascriptAgainstTestCases(code, testCases, expectedFunctionName, mode);
}

type CatalogProblem = {
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  category: string;
  statement: string;
  constraints?: string[];
  examples?: Array<{
    input: string;
    output: string;
    explanation?: string;
  }>;
};

const additionalProblemCatalog: CatalogProblem[] = [
  { title: "Contains Duplicate", difficulty: "Easy", category: "Array", statement: "Given an integer array nums, return true if any value appears at least twice, and false if every element is distinct." },
  { title: "Valid Anagram", difficulty: "Easy", category: "String", statement: "Given two strings s and t, return true if t is an anagram of s, and false otherwise." },
  { title: "Group Anagrams", difficulty: "Medium", category: "Hash Table", statement: "Given an array of strings, group the anagrams together and return the grouped list." },
  { title: "Top K Frequent Elements", difficulty: "Medium", category: "Heap", statement: "Given an integer array and an integer k, return the k most frequent elements." },
  { title: "Product of Array Except Self", difficulty: "Medium", category: "Array", statement: "Return an array where output[i] equals the product of all elements of nums except nums[i]." },
  { title: "Longest Consecutive Sequence", difficulty: "Medium", category: "Array", statement: "Given an unsorted array, return the length of the longest consecutive elements sequence." },
  { title: "Palindrome Number", difficulty: "Easy", category: "Math", statement: "Given an integer x, return true if x is a palindrome, and false otherwise." },
  { title: "Roman to Integer", difficulty: "Easy", category: "String", statement: "Convert a roman numeral string to its integer value." },
  { title: "Longest Common Prefix", difficulty: "Easy", category: "String", statement: "Find the longest common prefix among an array of strings." },
  { title: "Remove Duplicates from Sorted Array", difficulty: "Easy", category: "Two Pointers", statement: "Remove duplicates in-place from a sorted array and return the number of unique elements." },
  { title: "Remove Element", difficulty: "Easy", category: "Array", statement: "Remove all occurrences of val in-place and return the new length." },
  { title: "Find the Index of the First Occurrence in a String", difficulty: "Easy", category: "String", statement: "Return the index of the first occurrence of needle in haystack, or -1 if needle is not part of haystack." },
  { title: "Search Insert Position", difficulty: "Easy", category: "Binary Search", statement: "Given a sorted array and a target, return the index if found or the insertion position if not found." },
  { title: "Length of Last Word", difficulty: "Easy", category: "String", statement: "Return the length of the last word in a string." },
  { title: "Plus One", difficulty: "Easy", category: "Array", statement: "Given a non-empty integer array representing a non-negative integer, increment one to the integer." },
  { title: "Add Binary", difficulty: "Easy", category: "Bit Manipulation", statement: "Given two binary strings a and b, return their sum as a binary string." },
  { title: "Sqrt(x)", difficulty: "Easy", category: "Binary Search", statement: "Compute and return the integer square root of x." },
  { title: "Climbing Stairs", difficulty: "Easy", category: "Dynamic Programming", statement: "Given n steps, return how many distinct ways you can climb to the top with 1 or 2 steps at a time." },
  { title: "Same Tree", difficulty: "Easy", category: "Tree", statement: "Given two binary trees, check if they are structurally identical and have the same node values." },
  { title: "Symmetric Tree", difficulty: "Easy", category: "Tree", statement: "Determine whether a binary tree is a mirror of itself." },
  { title: "Maximum Depth of Binary Tree", difficulty: "Easy", category: "Tree", statement: "Return the maximum depth of a binary tree." },
  { title: "Convert Sorted Array to Binary Search Tree", difficulty: "Easy", category: "Tree", statement: "Convert a sorted array to a height-balanced binary search tree." },
  { title: "Balanced Binary Tree", difficulty: "Easy", category: "Tree", statement: "Return true if a binary tree is height-balanced, otherwise false." },
  { title: "Minimum Depth of Binary Tree", difficulty: "Easy", category: "Tree", statement: "Find the minimum depth from root to nearest leaf node." },
  { title: "Path Sum", difficulty: "Easy", category: "Tree", statement: "Given a binary tree and target sum, determine if the tree has a root-to-leaf path with that sum." },
  { title: "Pascal's Triangle", difficulty: "Easy", category: "Dynamic Programming", statement: "Generate the first numRows of Pascal's triangle." },
  { title: "Best Time to Buy and Sell Stock II", difficulty: "Easy", category: "Greedy", statement: "Given stock prices, return the maximum profit by making as many transactions as you like." },
  { title: "Valid Palindrome", difficulty: "Easy", category: "Two Pointers", statement: "Check whether a string is a palindrome considering only alphanumeric characters and ignoring case." },
  { title: "Single Number", difficulty: "Easy", category: "Bit Manipulation", statement: "Find the element that appears only once when every other element appears exactly twice." },
  { title: "Linked List Cycle", difficulty: "Easy", category: "Linked List", statement: "Determine if a linked list has a cycle." },
  { title: "Intersection of Two Linked Lists", difficulty: "Easy", category: "Linked List", statement: "Return the node where two linked lists intersect, or null if they do not intersect." },
  { title: "Majority Element", difficulty: "Easy", category: "Array", statement: "Find the majority element that appears more than n/2 times." },
  { title: "Excel Sheet Column Number", difficulty: "Easy", category: "Math", statement: "Convert an Excel column title into its corresponding column number." },
  { title: "Rotate Array", difficulty: "Medium", category: "Array", statement: "Rotate an array to the right by k steps." },
  { title: "Reverse Bits", difficulty: "Easy", category: "Bit Manipulation", statement: "Reverse bits of a given 32-bit unsigned integer." },
  { title: "Number of 1 Bits", difficulty: "Easy", category: "Bit Manipulation", statement: "Return the number of set bits in a positive integer." },
  { title: "House Robber", difficulty: "Medium", category: "Dynamic Programming", statement: "Given non-negative integers representing money in houses, find max amount you can rob without robbing adjacent houses." },
  { title: "Number of Islands", difficulty: "Medium", category: "Graph", statement: "Given a 2D grid of '1's and '0's, count the number of islands." },
  { title: "Reverse Linked List", difficulty: "Easy", category: "Linked List", statement: "Reverse a singly linked list and return the new head." },
  { title: "Course Schedule", difficulty: "Medium", category: "Graph", statement: "Given numCourses and prerequisite pairs, determine if you can finish all courses." },
  { title: "Implement Trie (Prefix Tree)", difficulty: "Medium", category: "Trie", statement: "Implement insert, search, and startsWith operations for a Trie." },
  { title: "Minimum Size Subarray Sum", difficulty: "Medium", category: "Sliding Window", statement: "Find the minimal length of a contiguous subarray with sum greater than or equal to target." },
  { title: "Kth Largest Element in an Array", difficulty: "Medium", category: "Heap", statement: "Find the kth largest element in an unsorted array." },
  { title: "Contains Duplicate II", difficulty: "Easy", category: "Hash Table", statement: "Return true if there are two distinct indices i and j such that nums[i] == nums[j] and |i - j| <= k." },
  { title: "Invert Binary Tree", difficulty: "Easy", category: "Tree", statement: "Invert a binary tree and return its root." },
  { title: "Summary Ranges", difficulty: "Easy", category: "Array", statement: "Given a sorted unique integer array, return the smallest sorted list of ranges that cover all numbers." },
  { title: "Power of Two", difficulty: "Easy", category: "Math", statement: "Given an integer n, return true if it is a power of two." },
  { title: "Palindrome Linked List", difficulty: "Easy", category: "Linked List", statement: "Check whether a singly linked list is a palindrome." },
  { title: "Lowest Common Ancestor of a Binary Search Tree", difficulty: "Easy", category: "Tree", statement: "Given a BST and two nodes p and q, find their lowest common ancestor." },
  { title: "Delete Node in a Linked List", difficulty: "Medium", category: "Linked List", statement: "Delete a node (except tail) in a singly linked list, given only access to that node." },
  { title: "Valid Sudoku", difficulty: "Medium", category: "Matrix", statement: "Determine if a 9x9 Sudoku board is valid." },
  { title: "Combination Sum", difficulty: "Medium", category: "Backtracking", statement: "Return all unique combinations of candidates where chosen numbers sum to target." },
  { title: "Permutations", difficulty: "Medium", category: "Backtracking", statement: "Return all possible permutations of an array of distinct integers." },
  { title: "Rotate Image", difficulty: "Medium", category: "Matrix", statement: "Rotate an n x n 2D matrix by 90 degrees clockwise in-place." },
  { title: "Maximum Product Subarray", difficulty: "Medium", category: "Dynamic Programming", statement: "Find the contiguous subarray with the largest product." },
  { title: "Find Minimum in Rotated Sorted Array", difficulty: "Medium", category: "Binary Search", statement: "Find the minimum element in a rotated sorted array." },
  { title: "Min Stack", difficulty: "Medium", category: "Stack", statement: "Design a stack that supports push, pop, top, and retrieving minimum in constant time." },
  { title: "Evaluate Reverse Polish Notation", difficulty: "Medium", category: "Stack", statement: "Evaluate the value of an arithmetic expression in Reverse Polish Notation." },
  { title: "Two Sum II - Input Array Is Sorted", difficulty: "Easy", category: "Two Pointers", statement: "Find indices of two numbers in a sorted array that add up to target." },
  { title: "Majority Element II", difficulty: "Medium", category: "Array", statement: "Find all elements appearing more than n/3 times in an array." },
  { title: "Missing Number", difficulty: "Easy", category: "Math", statement: "Given an array containing n distinct numbers in range [0, n], find the missing number." },
  { title: "Move Zeroes", difficulty: "Easy", category: "Two Pointers", statement: "Move all zeroes to end while maintaining relative order of non-zero elements." },
  { title: "Find the Duplicate Number", difficulty: "Medium", category: "Two Pointers", statement: "Find the duplicated number in an array containing n+1 integers where each integer is in [1, n]." },
  { title: "Longest Increasing Subsequence", difficulty: "Medium", category: "Dynamic Programming", statement: "Return the length of the longest strictly increasing subsequence." },
  { title: "Coin Change", difficulty: "Medium", category: "Dynamic Programming", statement: "Given coin denominations and amount, return fewest coins needed, or -1 if impossible." },
  { title: "Power of Three", difficulty: "Easy", category: "Math", statement: "Determine if a number is a power of three." },
  { title: "Counting Bits", difficulty: "Easy", category: "Dynamic Programming", statement: "For every i in [0, n], return number of 1 bits in i." },
  { title: "Top K Frequent Words", difficulty: "Medium", category: "Heap", statement: "Return the k most frequent words sorted by frequency then lexicographical order." },
  { title: "Decode String", difficulty: "Medium", category: "Stack", statement: "Decode an encoded string where k[encoded_string] means encoded_string repeated k times." },
  { title: "Queue Reconstruction by Height", difficulty: "Medium", category: "Greedy", statement: "Reconstruct queue based on height and number of taller or equal people in front." },
  { title: "Partition Equal Subset Sum", difficulty: "Medium", category: "Dynamic Programming", statement: "Determine if array can be partitioned into two subsets with equal sum." },
  { title: "Trapping Rain Water", difficulty: "Hard", category: "Two Pointers", statement: "Given heights, compute how much water can be trapped after raining." },
  { title: "Merge k Sorted Lists", difficulty: "Hard", category: "Linked List", statement: "Merge k sorted linked lists and return one sorted list." },
  { title: "N-Queens", difficulty: "Hard", category: "Backtracking", statement: "Place n queens on n x n board so that no two queens attack each other; return all solutions." },
  { title: "Word Ladder", difficulty: "Hard", category: "Graph", statement: "Find shortest transformation sequence length from beginWord to endWord using word list transformations." },
  { title: "Largest Rectangle in Histogram", difficulty: "Hard", category: "Stack", statement: "Given bar heights, return area of the largest rectangle in histogram." },
  { title: "Maximal Rectangle", difficulty: "Hard", category: "Stack", statement: "Given binary matrix, find largest rectangle containing only 1's." },
  { title: "Binary Tree Maximum Path Sum", difficulty: "Hard", category: "Tree", statement: "Return maximum path sum of any non-empty path in a binary tree." },
  { title: "Word Break II", difficulty: "Hard", category: "Dynamic Programming", statement: "Return all possible sentences where spaces are inserted so each word is in dictionary." },
  { title: "Serialize and Deserialize Binary Tree", difficulty: "Hard", category: "Tree", statement: "Design algorithms to serialize and deserialize a binary tree." },
  { title: "Sliding Window Maximum", difficulty: "Hard", category: "Sliding Window", statement: "Given array and window size k, return maximum in each sliding window." },
  { title: "Minimum Window Substring", difficulty: "Hard", category: "Sliding Window", statement: "Find the minimum window in s which contains all characters of t." },
  { title: "Edit Distance", difficulty: "Hard", category: "Dynamic Programming", statement: "Compute minimum operations (insert, delete, replace) to convert one string to another." },
  { title: "Burst Balloons", difficulty: "Hard", category: "Dynamic Programming", statement: "Return maximum coins collected by bursting balloons in optimal order." },
  { title: "Median of Two Sorted Arrays", difficulty: "Hard", category: "Binary Search", statement: "Find median of two sorted arrays in O(log(m+n)) time." },
  { title: "Regular Expression Matching", difficulty: "Hard", category: "Dynamic Programming", statement: "Implement regex matching with support for '.' and '*' for entire string." },
  { title: "Distinct Subsequences", difficulty: "Hard", category: "Dynamic Programming", statement: "Count number of distinct subsequences of s that equal t." },
  { title: "Interleaving String", difficulty: "Medium", category: "Dynamic Programming", statement: "Determine if s3 is formed by interleaving s1 and s2." },
  { title: "Reorder List", difficulty: "Medium", category: "Linked List", statement: "Reorder linked list as L0->Ln->L1->Ln-1 and so on." },
  { title: "Sort Colors", difficulty: "Medium", category: "Two Pointers", statement: "Sort array containing 0, 1, and 2 in-place." },
  { title: "Subsets", difficulty: "Medium", category: "Backtracking", statement: "Return all possible subsets (power set) of distinct integers." },
  { title: "Subsets II", difficulty: "Medium", category: "Backtracking", statement: "Return all possible subsets of nums that may contain duplicates, without duplicate subsets." },
  { title: "Combinations", difficulty: "Medium", category: "Backtracking", statement: "Return all combinations of k numbers out of range [1, n]." },
  { title: "Word Search", difficulty: "Medium", category: "Backtracking", statement: "Determine if a word exists in a board by moving horizontally or vertically without revisiting cells." },
  { title: "Sort List", difficulty: "Medium", category: "Linked List", statement: "Sort a linked list in O(n log n) time and constant space complexity." },
  { title: "LRU Cache", difficulty: "Medium", category: "Design", statement: "Design a data structure that supports get and put in O(1) for LRU caching." },
  { title: "Design Add and Search Words Data Structure", difficulty: "Medium", category: "Trie", statement: "Design data structure supporting addWord and search with '.' wildcard." },
  { title: "Implement Queue using Stacks", difficulty: "Easy", category: "Stack", statement: "Implement queue operations using two stacks." },
  { title: "Daily Temperatures", difficulty: "Medium", category: "Stack", statement: "For each day, return how many days to wait for a warmer temperature." },
  { title: "Asteroid Collision", difficulty: "Medium", category: "Stack", statement: "Given moving asteroids, return state after all collisions." },
  { title: "Network Delay Time", difficulty: "Medium", category: "Graph", statement: "Given travel times in directed graph, return time for all nodes to receive signal from source." },
  { title: "Cheapest Flights Within K Stops", difficulty: "Medium", category: "Graph", statement: "Find cheapest flight from src to dst with at most k stops." },
  { title: "Minimum Cost to Connect Points", difficulty: "Medium", category: "Graph", statement: "Given points in 2D, return minimum cost to connect all points using Manhattan distance edges." },
  { title: "Reconstruct Itinerary", difficulty: "Hard", category: "Graph", statement: "Reconstruct itinerary from flight tickets in lexical order, starting at JFK." },
];

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatProblemDescription(problem: CatalogProblem): string {
  const examples =
    problem.examples ?? [
      {
        input: "input = [1,2,3]",
        output: "[1,2,3]",
        explanation: "This example uses the simplified runner format in this app.",
      },
      {
        input: "input = [4,5]",
        output: "[4,5]",
      },
    ];

  const constraints = problem.constraints ?? [
    "1 <= input size <= 10^5 (problem dependent).",
    "Aim for a solution suitable for the listed difficulty.",
    "Return output in the exact expected format.",
  ];

  const examplesText = examples
    .map((ex, idx) => {
      const explanation = ex.explanation ? `\nExplanation: ${ex.explanation}` : "";
      return `**Example ${idx + 1}:**\nInput: ${ex.input}\nOutput: ${ex.output}${explanation}`;
    })
    .join("\n\n");

  return `${problem.statement}

${examplesText}

**Constraints:**
${constraints.map((c) => `- ${c}`).join("\n")}

**Implementation Note (this app):**
- Implement \`solve(input)\` in JavaScript or Python.
- Testcases use a simplified single-argument input format in this project.`;
}

function buildGeneratedProblems(count: number, startOrder: number): InsertProblem[] {
  const generated: InsertProblem[] = [];

  for (let i = 0; i < count; i++) {
    const order = startOrder + i;
    const item =
      additionalProblemCatalog[i] ??
      ({
        title: `Algorithm Practice ${order}`,
        difficulty: i % 3 === 0 ? "Easy" : i % 3 === 1 ? "Medium" : "Hard",
        category: "Algorithms",
        statement:
          "Solve the given problem by implementing an efficient algorithm.",
      } satisfies CatalogProblem);

    const starterCode = `function solve(input) {
  // Implement your solution and return the expected output.
  return input;
};`;

    generated.push({
      title: item.title,
      slug: slugifyTitle(item.title),
      difficulty: item.difficulty,
      category: item.category,
      description: formatProblemDescription(item),
      starterCode,
      testCases: [
        { input: "input = [1,2,3]", output: "[1,2,3]" },
        { input: "input = [4,5]", output: "[4,5]" },
      ],
      order,
    });
  }

  return generated;
}

async function seedDatabase() {
  const existingProblems = await storage.getProblems();
  const existingSlugs = new Set(existingProblems.map((problem) => problem.slug));
  const existingByOrder = new Map(existingProblems.map((problem) => [problem.order, problem]));

  const curatedProblems: InsertProblem[] = [
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

**Constraints:**
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Exactly one valid answer exists.
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

**Constraints:**
- 1 <= s.length <= 10^4
- s consists only of parentheses characters: '()[]{}'
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

**Constraints:**
- The number of nodes in both lists is in the range [0, 50]
- -100 <= Node.val <= 100
- Both list1 and list2 are sorted in non-decreasing order
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

**Constraints:**
- 1 <= prices.length <= 10^5
- 0 <= prices[i] <= 10^4
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

**Constraints:**
- 1 <= nums.length <= 10^5
- -10^4 <= nums[i] <= 10^4
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

**Constraints:**
- 1 <= nums.length <= 10^4
- -10^4 < nums[i], target < 10^4
- All the integers in nums are unique.
- nums is sorted in ascending order.
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

  const targetTotal = 100;
  const generatedCount = Math.max(0, targetTotal - curatedProblems.length);
  const generatedStartOrder = curatedProblems.length + 1;
  const defaultProblems: InsertProblem[] = [
    ...curatedProblems,
    ...buildGeneratedProblems(generatedCount, generatedStartOrder),
  ];

  for (const problem of defaultProblems) {
    const existing = existingByOrder.get(problem.order ?? -1);

    if (!existing) {
      if (!existingSlugs.has(problem.slug)) {
        await storage.createProblem(problem);
      }
      continue;
    }

    const isCuratedSlot = (existing.order ?? 0) >= 1 && (existing.order ?? 0) < generatedStartOrder;
    const isGeneratedSlot = (existing.order ?? 0) >= generatedStartOrder;
    const isPlaceholder =
      existing.slug.startsWith("practice-challenge-") ||
      existing.title.startsWith("Practice Challenge");

    if (isCuratedSlot || isGeneratedSlot || isPlaceholder) {
      await db
        .update(problems)
        .set({
          title: problem.title,
          slug: problem.slug,
          difficulty: problem.difficulty,
          category: problem.category,
          description: problem.description,
          starterCode: problem.starterCode,
          testCases: problem.testCases,
          order: problem.order,
        })
        .where(eq(problems.id, existing.id));
    }
  }
}
