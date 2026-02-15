import { useEffect, useMemo, useState } from "react";
import { useProblems, useSubmissions } from "@/hooks/use-problems";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const DIFFICULTY_COLORS = {
  Easy: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  Medium: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
  Hard: "text-red-500 bg-red-500/10 border-red-500/20",
};

export default function ProblemList() {
  const { data: problems, isLoading } = useProblems();
  const { user } = useAuth();
  const { data: submissions } = useSubmissions();
  const [search, setSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<"All" | "Easy" | "Medium" | "Hard">("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "Solved" | "Unsolved">("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"order-asc" | "order-desc" | "title-asc" | "difficulty">("order-asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const solvedProblemIds = new Set(
    user
      ? (submissions ?? [])
          .filter((submission) => submission.status === "Accepted")
          .map((submission) => submission.problemId)
      : []
  );
  const categories = useMemo(() => {
    const set = new Set((problems ?? []).map((problem) => problem.category));
    return ["All", ...Array.from(set).sort()];
  }, [problems]);

  const filteredProblems = useMemo(() => {
    let data = [...(problems ?? [])];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(
        (problem) =>
          problem.title.toLowerCase().includes(q) ||
          problem.category.toLowerCase().includes(q) ||
          String(problem.order).includes(q)
      );
    }

    if (difficultyFilter !== "All") {
      data = data.filter((problem) => problem.difficulty === difficultyFilter);
    }

    if (categoryFilter !== "All") {
      data = data.filter((problem) => problem.category === categoryFilter);
    }

    if (statusFilter !== "All") {
      data = data.filter((problem) =>
        statusFilter === "Solved"
          ? solvedProblemIds.has(problem.id)
          : !solvedProblemIds.has(problem.id)
      );
    }

    const difficultyRank: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3 };
    data.sort((a, b) => {
      if (sortBy === "order-asc") return (a.order ?? 0) - (b.order ?? 0);
      if (sortBy === "order-desc") return (b.order ?? 0) - (a.order ?? 0);
      if (sortBy === "title-asc") return a.title.localeCompare(b.title);
      return (difficultyRank[a.difficulty] ?? 99) - (difficultyRank[b.difficulty] ?? 99);
    });

    return data;
  }, [problems, search, difficultyFilter, categoryFilter, statusFilter, sortBy, solvedProblemIds]);

  const totalPages = Math.max(1, Math.ceil(filteredProblems.length / pageSize));
  const pagedProblems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredProblems.slice(start, start + pageSize);
  }, [filteredProblems, page]);

  useEffect(() => {
    setPage(1);
  }, [search, difficultyFilter, categoryFilter, statusFilter, sortBy]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const solvedCount = solvedProblemIds.size;
  const totalCount = problems?.length ?? 0;
  const unsolvedCount = Math.max(0, totalCount - solvedCount);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Navbar />

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <h1 className="text-3xl font-bold font-display mb-2">Problems</h1>
              <p className="text-muted-foreground">
                Sharpen your coding skills with our collection of algorithm challenges.
              </p>
            </div>

            <div className="mb-6 grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title, category, or number..."
                  className="md:col-span-2"
                />
                <select
                  value={difficultyFilter}
                  onChange={(e) => setDifficultyFilter(e.target.value as "All" | "Easy" | "Medium" | "Hard")}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="All">All Difficulties</option>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "All" | "Solved" | "Unsolved")}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="All">All Status</option>
                  <option value="Solved">Solved</option>
                  <option value="Unsolved">Unsolved</option>
                </select>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category === "All" ? "All Categories" : category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Total: {totalCount}</Badge>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                    Solved: {solvedCount}
                  </Badge>
                  <Badge variant="outline" className="text-muted-foreground">
                    Unsolved: {unsolvedCount}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "order-asc" | "order-desc" | "title-asc" | "difficulty"
                      )
                    }
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="order-asc">Order (Asc)</option>
                    <option value="order-desc">Order (Desc)</option>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="difficulty">Difficulty</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead className="w-[400px]">Title</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="border-border">
                        <TableCell><Skeleton className="h-5 w-5 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-9 w-24 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredProblems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        No problems match your filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedProblems.map((problem) => (
                      <TableRow key={problem.id} className="group border-border hover:bg-accent/30 transition-colors">
                        {(() => {
                          const isSolved = solvedProblemIds.has(problem.id);
                          return (
                            <>
                        <TableCell>
                          {isSolved ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          ) : (
                            <Circle className="w-5 h-5 text-muted-foreground/30" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Link href={`/problems/${problem.id}`}>
                            <a className="font-medium text-foreground group-hover:text-primary transition-colors block py-2">
                              {problem.order}. {problem.title}
                            </a>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={cn("font-medium border", DIFFICULTY_COLORS[problem.difficulty as keyof typeof DIFFICULTY_COLORS])}
                          >
                            {problem.difficulty}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {problem.category}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium border",
                                isSolved
                                  ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
                                  : "text-muted-foreground bg-muted/40 border-border"
                              )}
                            >
                              {isSolved ? "Solved" : "Unsolved"}
                            </Badge>
                            <Link href={`/problems/${problem.id}`}>
                              <Button variant="secondary" size="sm">
                                Solve
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                            </>
                          );
                        })()}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {!isLoading && filteredProblems.length > 0 ? (
                <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Showing {(page - 1) * pageSize + 1}-
                    {Math.min(page * pageSize, filteredProblems.length)} of {filteredProblems.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      Prev
                    </Button>
                    <span className="text-muted-foreground">
                      Page {page}/{totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full md:w-80 flex-shrink-0 space-y-6">
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="font-display font-bold text-lg mb-4">Daily Challenge</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Today's Solvers</span>
                  <span className="font-mono">1,234</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-[65%] bg-gradient-to-r from-primary to-primary/60 rounded-full" />
                </div>
                <Button className="w-full" variant="outline">View Challenge</Button>
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl border border-primary/20 p-6">
              <h3 className="font-display font-bold text-lg mb-2 text-primary">Pro Features</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Unlock detailed solutions, company tags, and more.
              </p>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Go Premium
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
