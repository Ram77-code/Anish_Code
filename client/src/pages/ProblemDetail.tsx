import { useState } from "react";
import { useParams, Link } from "wouter";
import { useProblem, useSubmitSolution } from "@/hooks/use-problems";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, CheckCircle, AlertCircle, ChevronLeft } from "lucide-react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export default function ProblemDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { data: problem, isLoading } = useProblem(id);
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [code, setCode] = useState("");
  const [activeTab, setActiveTab] = useState("description");

  // Initialize code when problem loads
  useState(() => {
    if (problem) setCode(problem.starterCode);
  });

  const submitMutation = useSubmitSolution();

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
      { code, problemId: id },
      {
        onSuccess: () => {
          toast({
            title: "Submission Received",
            description: "Your solution has been submitted successfully.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to submit solution. Please try again.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const difficultyColor = {
    Easy: "text-emerald-500 bg-emerald-500/10",
    Medium: "text-yellow-500 bg-yellow-500/10",
    Hard: "text-red-500 bg-red-500/10",
  }[problem.difficulty] || "text-gray-500";

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          
          {/* LEFT PANEL: Description */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col border-r border-border bg-card">
              <div className="p-2 border-b border-border bg-muted/30">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
                    <h1 className="text-2xl font-bold font-display">{problem.order}. {problem.title}</h1>
                    <Badge variant="secondary" className={cn("font-medium border-0", difficultyColor)}>
                      {problem.difficulty}
                    </Badge>
                  </div>

                  <div className="prose prose-invert prose-headings:font-display prose-p:text-muted-foreground prose-pre:bg-secondary prose-pre:border prose-pre:border-border max-w-none">
                    <ReactMarkdown>{problem.description}</ReactMarkdown>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT PANEL: Editor */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col bg-[#1e1e1e]">
              <div className="flex items-center justify-between p-2 border-b border-border bg-card">
                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 bg-secondary rounded text-xs font-mono text-muted-foreground">
                    JavaScript
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-8">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                </div>
              </div>

              <div className="flex-1 relative">
                <Editor
                  height="100%"
                  defaultLanguage="javascript"
                  value={code || problem.starterCode}
                  onChange={(val) => setCode(val || "")}
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

              <div className="p-4 border-t border-border bg-card flex justify-end gap-3">
                <Button variant="secondary" className="font-semibold" onClick={() => toast({ title: "Run Code", description: "Running test cases locally..." })}>
                  <Play className="w-4 h-4 mr-2" />
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
          </ResizablePanel>

        </ResizablePanelGroup>
      </div>
    </div>
  );
}
