import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import {
  useProblem,
  useRunCode,
  useSubmitSolution,
  useSubmissions,
} from "@/hooks/use-problems";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, CheckCircle, AlertCircle } from "lucide-react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

type RunResult = {
  status: "Accepted" | "Wrong Answer" | "Runtime Error";
  runtime: number;
  passed: number;
  total: number;
  results: Array<{
    input: string;
    expected: string;
    actual?: string;
    passed: boolean;
    error?: string;
  }>;
};

type SupportedLanguage = "javascript" | "python";

function jsStarterToPythonStarter(starterCode: string): string {
  const fnMatch = starterCode.match(
    /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/m
  );
  if (!fnMatch) {
    return `def solution(*args):\n    # Write your code here\n    pass\n`;
  }

  const [, name, argsCsv] = fnMatch;
  const args = argsCsv
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean)
    .join(", ");
  return `def ${name}(${args}):\n    # Write your code here\n    pass\n`;
}

export default function ProblemDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { data: problem, isLoading } = useProblem(id);
  const { user } = useAuth();
  const { toast } = useToast();

  const [language, setLanguage] = useState<SupportedLanguage>("javascript");
  const [codeByLanguage, setCodeByLanguage] = useState<
    Record<SupportedLanguage, string>
  >({
    javascript: "",
    python: "",
  });
  const [activeTab, setActiveTab] = useState("description");
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  useEffect(() => {
    if (problem) {
      setCodeByLanguage({
        javascript: problem.starterCode,
        python: jsStarterToPythonStarter(problem.starterCode),
      });
      setLanguage("javascript");
      setRunResult(null);
    }
  }, [problem]);

  const submitMutation = useSubmitSolution();
  const runMutation = useRunCode();
  const { data: allSubmissions } = useSubmissions();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background gap-4">
        <h1 className="text-2xl font-bold">Problem not found</h1>
        <Link href="/">
          <Button>Return Home</Button>
        </Link>
      </div>
    );
  }

  const handleSubmit = () => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to submit your solution.",
        variant: "destructive",
      });
      return;
    }

    submitMutation.mutate(
      {
        code: codeByLanguage[language],
        problemId: id,
        language,
      },
      {
        onSuccess: () => {
          toast({
            title: "Submission Received",
            description: "Your solution has been submitted successfully.",
          });
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: extractApiError(error),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRun = () => {
    runMutation.mutate(
      {
        code: codeByLanguage[language],
        problemId: id,
        language,
      },
      {
        onSuccess: (result) => {
          setRunResult(result);
          toast({
            title: result.status,
            description: `Passed ${result.passed}/${result.total} tests in ${result.runtime}ms`,
          });
        },
        onError: (error) => {
          setRunResult(null);
          toast({
            title: "Run Failed",
            description: extractApiError(error),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleReset = () => {
    setCodeByLanguage((prev) => ({
      ...prev,
      [language]:
        language === "javascript"
          ? problem.starterCode
          : jsStarterToPythonStarter(problem.starterCode),
    }));
    setRunResult(null);
  };

  const handleLanguageChange = (nextLanguage: SupportedLanguage) => {
    setLanguage(nextLanguage);
    setRunResult(null);
  };

  const difficultyColor = {
    Easy: "text-emerald-500 bg-emerald-500/10",
    Medium: "text-yellow-500 bg-yellow-500/10",
    Hard: "text-red-500 bg-red-500/10",
  }[problem.difficulty] || "text-gray-500";
  const problemSubmissions = (allSubmissions ?? []).filter(
    (submission) => submission.problemId === id
  );

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Navbar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col border-r border-border bg-card">
              <div className="p-2 border-b border-border bg-muted/30">
                <Tabs
                  value={activeTab}
                  onValueChange={setActiveTab}
                  className="w-full"
                >
                  <TabsList className="h-9 w-full justify-start bg-transparent p-0">
                    <TabsTrigger
                      value="description"
                      className="data-[state=active]:bg-background data-[state=active]:shadow-none border border-transparent data-[state=active]:border-border rounded-t-lg rounded-b-none h-full px-4"
                    >
                      Description
                    </TabsTrigger>
                    <TabsTrigger
                      value="submissions"
                      className="data-[state=active]:bg-background data-[state=active]:shadow-none border border-transparent data-[state=active]:border-border rounded-t-lg rounded-b-none h-full px-4"
                    >
                      Submissions
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <ScrollArea className="flex-1 p-6">
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center gap-3 mb-4">
                    <h1 className="text-2xl font-bold font-display">
                      {problem.order}. {problem.title}
                    </h1>
                    <Badge
                      variant="secondary"
                      className={cn("font-medium border-0", difficultyColor)}
                    >
                      {problem.difficulty}
                    </Badge>
                  </div>

                  {activeTab === "description" ? (
                    <div className="prose prose-invert prose-headings:font-display prose-p:text-muted-foreground prose-pre:bg-secondary prose-pre:border prose-pre:border-border max-w-none">
                      <ReactMarkdown>{problem.description}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {!user ? (
                        <p className="text-sm text-muted-foreground">
                          Sign in to view your submissions.
                        </p>
                      ) : problemSubmissions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No submissions yet for this problem.
                        </p>
                      ) : (
                        problemSubmissions.map((submission) => (
                          <div
                            key={submission.id}
                            className="rounded-md border border-border bg-background p-3"
                          >
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                              <span>
                                {submission.status} | {submission.runtime ?? 0}ms
                              </span>
                              <span>
                                {submission.createdAt
                                  ? new Date(submission.createdAt).toLocaleString()
                                  : ""}
                              </span>
                            </div>
                            <pre className="text-xs whitespace-pre-wrap break-words bg-secondary/40 border border-border rounded p-2 max-h-56 overflow-auto">
                              <code>{submission.code}</code>
                            </pre>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col bg-[#1e1e1e]">
              <div className="flex items-center justify-between p-2 border-b border-border bg-card">
                <div className="flex items-center gap-2">
                  <Button
                    variant={language === "javascript" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 font-mono text-xs"
                    onClick={() => handleLanguageChange("javascript")}
                  >
                    JavaScript
                  </Button>
                  <Button
                    variant={language === "python" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 font-mono text-xs"
                    onClick={() => handleLanguageChange("python")}
                  >
                    Python
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={handleReset}
                  >
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                </div>
              </div>

              <div className="flex-1 relative">
                <Editor
                  height="100%"
                  defaultLanguage={language}
                  language={language}
                  value={codeByLanguage[language]}
                  onChange={(val) =>
                    setCodeByLanguage((prev) => ({
                      ...prev,
                      [language]: val || "",
                    }))
                  }
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                />
              </div>

              <div className="p-4 border-t border-border bg-card space-y-3">
                <div className="flex justify-end gap-3">
                  <Button
                    variant="secondary"
                    className="font-semibold"
                    onClick={handleRun}
                    disabled={runMutation.isPending}
                  >
                    {runMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    Run
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={submitMutation.isPending}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold shadow-[0_0_15px_rgba(22,163,74,0.4)]"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Submit
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="border-t border-border bg-card">
                <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">
                  Run Result
                </div>
                <ScrollArea className="h-56 px-4 pb-4">
                  {!runResult ? (
                    <p className="text-xs text-muted-foreground py-2">
                      Click Run to execute test cases. Results will appear here.
                    </p>
                  ) : (
                    <div className="rounded-md border border-border p-3 bg-background">
                      <p className="text-sm font-semibold mb-2">
                        {runResult.status} | {runResult.passed}/{runResult.total} passed |{" "}
                        {runResult.runtime}ms
                      </p>
                      <div className="space-y-2">
                        {runResult.results.map((result, idx) => (
                          <div
                            key={`${idx}-${result.input}`}
                            className="text-xs text-muted-foreground border border-border rounded p-2"
                          >
                            <p
                              className={
                                result.passed ? "text-emerald-400" : "text-red-400"
                              }
                            >
                              Test {idx + 1}: {result.passed ? "Passed" : "Failed"}
                            </p>
                            <p>Input: {result.input}</p>
                            <p>Expected: {result.expected}</p>
                            {!result.passed && result.actual !== undefined ? (
                              <p>Actual: {result.actual}</p>
                            ) : null}
                            {!result.passed && result.error ? (
                              <p>Error: {result.error}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function extractApiError(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^\d+:\s*([\s\S]*)$/);
    if (match?.[1]) {
      return match[1];
    }
    return error.message;
  }
  return "Request failed. Please try again.";
}
